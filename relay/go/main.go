// htmlroom-relay: a broadcast relay for decentralized (version 3) HTML Room
// rooms, in one dependency-free binary for Windows, macOS, Linux, BSD and
// routers (OpenWrt mips/arm).
//
// It forwards each text frame on /bc/<topic> to the other connections on the
// same topic. Frames are sealed by the members with a key the relay never sees;
// the relay keeps nothing on disk and logs no topics or addresses.
//
//	htmlroom-relay                     listen on :8080 (put HTTPS in front)
//	htmlroom-relay -tls-cert c -tls-key k -listen :443
//	htmlroom-relay -tunnel             no domain, no open port: a free
//	                                   Cloudflare quick tunnel gives a wss:// URL
package main

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

const version = "1.0.0"

var (
	listen      = flag.String("listen", ":8080", "address to listen on")
	tlsCert     = flag.String("tls-cert", "", "TLS certificate file (serve wss:// directly)")
	tlsKey      = flag.String("tls-key", "", "TLS key file")
	allowOrigin = flag.String("allow-origin", "", "comma-separated Origins browsers may connect from (default: any; data is end-to-end encrypted)")
	maxConns    = flag.Int("max-conns", 2000, "maximum simultaneous connections")
	maxPeers    = flag.Int("max-peers", 50, "maximum connections per topic")
	maxFrame    = flag.Int("max-frame", 16000, "maximum frame size in bytes")
	ratePer10s  = flag.Int("rate", 60, "frames per connection per 10 seconds")
	tunnel      = flag.Bool("tunnel", false, "start a Cloudflare quick tunnel (needs cloudflared) and print the public relay address")
	cloudflared = flag.String("cloudflared", "cloudflared", "path to the cloudflared binary")
	showVersion = flag.Bool("version", false, "print version and exit")
)

// Topic: the path after /bc/ (or the whole path, for clients configured with
// a bare host). The HTML Room client uses 32 hex characters.
var topicPath = regexp.MustCompile(`^/(?:bc/)?([A-Za-z0-9_-]{8,128})$`)

// out is never closed (senders hold no lock against close); done signals the end.
type conn struct {
	nc     net.Conn
	out    chan []byte
	done   chan struct{}
	once   sync.Once
	window int64
	count  int
}

func (c *conn) close() { c.once.Do(func() { close(c.done); c.nc.Close() }) }

type hub struct {
	mu     sync.Mutex
	topics map[string]map[*conn]bool
	total  int
}

func (h *hub) join(topic string, c *conn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	peers := h.topics[topic]
	if h.total >= *maxConns || len(peers) >= *maxPeers {
		return false
	}
	if peers == nil {
		peers = map[*conn]bool{}
		h.topics[topic] = peers
	}
	peers[c] = true
	h.total++
	return true
}

func (h *hub) leave(topic string, c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if peers := h.topics[topic]; peers[c] {
		delete(peers, c)
		h.total--
		if len(peers) == 0 {
			delete(h.topics, topic)
		}
	}
}

func (h *hub) forward(topic string, from *conn, frame []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.topics[topic] {
		if c == from {
			continue
		}
		select {
		case c.out <- frame:
		case <-c.done:
		default: // a reader this slow is dropped rather than holding up the room
			go c.close()
		}
	}
}

func originAllowed(origin string) bool {
	if *allowOrigin == "" || origin == "" || origin == "null" {
		return true
	}
	for _, o := range strings.Split(*allowOrigin, ",") {
		if strings.TrimSpace(o) == origin {
			return true
		}
	}
	return false
}

func headerHas(r *http.Request, name, token string) bool {
	for _, v := range r.Header.Values(name) {
		for _, p := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(p), token) {
				return true
			}
		}
	}
	return false
}

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

func (h *hub) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"ok":true,"version":%q,"kind":"bc"}`, version)
		return
	}
	m := topicPath.FindStringSubmatch(r.URL.Path)
	if m == nil {
		if r.URL.Path == "/" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			fmt.Fprintln(w, "HTML Room broadcast relay. Use it in a room as: bc+wss://<this host>/bc/")
			return
		}
		http.NotFound(w, r)
		return
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if r.Method != http.MethodGet || !headerHas(r, "Connection", "upgrade") || !headerHas(r, "Upgrade", "websocket") || key == "" || r.Header.Get("Sec-WebSocket-Version") != "13" {
		http.Error(w, "websocket only", http.StatusUpgradeRequired)
		return
	}
	if !originAllowed(r.Header.Get("Origin")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "cannot upgrade", http.StatusInternalServerError)
		return
	}
	nc, rw, err := hj.Hijack()
	if err != nil {
		return
	}
	sum := sha1.Sum([]byte(key + wsGUID))
	fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(sum[:]))
	if rw.Flush() != nil {
		nc.Close()
		return
	}
	c := &conn{nc: nc, out: make(chan []byte, 256), done: make(chan struct{})}
	topic := m[1]
	if !h.join(topic, c) {
		writeFrame(nc, 0x8, closePayload(1013, "full"))
		nc.Close()
		return
	}
	go c.writeLoop()
	h.readLoop(topic, c, rw.Reader)
	h.leave(topic, c)
	c.close()
}

func closePayload(code uint16, reason string) []byte {
	b := make([]byte, 2, 2+len(reason))
	binary.BigEndian.PutUint16(b, code)
	return append(b, reason...)
}

// Server frames are unmasked, single-fragment.
func writeFrame(w io.Writer, op byte, payload []byte) error {
	head := []byte{0x80 | op}
	switch n := len(payload); {
	case n < 126:
		head = append(head, byte(n))
	case n < 65536:
		head = append(head, 126, byte(n>>8), byte(n))
	default:
		head = append(head, 127, 0, 0, 0, 0, byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}
	_, err := w.Write(append(head, payload...))
	return err
}

// Queued items are [opcode, payload...].
func (c *conn) writeLoop() {
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.out:
			c.nc.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if writeFrame(c.nc, msg[0], msg[1:]) != nil {
				go c.close()
				return
			}
		case <-ping.C:
			c.nc.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if writeFrame(c.nc, 0x9, nil) != nil {
				go c.close()
				return
			}
		}
	}
}

func (c *conn) send(op byte, payload []byte) {
	select {
	case c.out <- append([]byte{op}, payload...):
	case <-c.done:
	default:
	}
}

var errProtocol = errors.New("protocol")

func (h *hub) readLoop(topic string, c *conn, r *bufio.Reader) {
	var msg []byte
	var msgOp byte
	for {
		c.nc.SetReadDeadline(time.Now().Add(75 * time.Second))
		fin, op, payload, err := readFrame(r, *maxFrame)
		if err != nil {
			if errors.Is(err, errProtocol) {
				c.send(0x8, closePayload(1009, "bad frame"))
				time.Sleep(50 * time.Millisecond)
			}
			return
		}
		switch op {
		case 0x8:
			c.send(0x8, closePayload(1000, ""))
			time.Sleep(50 * time.Millisecond)
			return
		case 0x9:
			c.send(0xA, payload)
			continue
		case 0xA:
			continue
		case 0x1:
			msg, msgOp = append(msg[:0], payload...), op
		case 0x0:
			if msgOp == 0 {
				return
			}
			msg = append(msg, payload...)
		default: // binary or reserved: this relay carries text only
			c.send(0x8, closePayload(1003, "text only"))
			time.Sleep(50 * time.Millisecond)
			return
		}
		if len(msg) > *maxFrame {
			c.send(0x8, closePayload(1009, "too big"))
			time.Sleep(50 * time.Millisecond)
			return
		}
		if !fin {
			continue
		}
		msgOp = 0
		if !utf8.Valid(msg) {
			return
		}
		window := time.Now().Unix() / 10
		if c.window != window {
			c.window, c.count = window, 0
		}
		if c.count++; c.count > *ratePer10s {
			c.send(0x8, closePayload(1008, "too fast"))
			time.Sleep(50 * time.Millisecond)
			return
		}
		h.forward(topic, c, append([]byte{0x1}, msg...))
	}
}

func readFrame(r *bufio.Reader, limit int) (fin bool, op byte, payload []byte, err error) {
	var head [2]byte
	if _, err = io.ReadFull(r, head[:]); err != nil {
		return
	}
	fin, op = head[0]&0x80 != 0, head[0]&0x0f
	if head[0]&0x70 != 0 || head[1]&0x80 == 0 { // no extensions; clients must mask
		return false, 0, nil, errProtocol
	}
	n := uint64(head[1] & 0x7f)
	switch n {
	case 126:
		var b [2]byte
		if _, err = io.ReadFull(r, b[:]); err != nil {
			return
		}
		n = uint64(binary.BigEndian.Uint16(b[:]))
	case 127:
		var b [8]byte
		if _, err = io.ReadFull(r, b[:]); err != nil {
			return
		}
		n = binary.BigEndian.Uint64(b[:])
	}
	if n > uint64(limit) || (op >= 0x8 && (n > 125 || !fin)) {
		return false, 0, nil, errProtocol
	}
	var mask [4]byte
	if _, err = io.ReadFull(r, mask[:]); err != nil {
		return
	}
	payload = make([]byte, n)
	if _, err = io.ReadFull(r, payload); err != nil {
		return
	}
	for i := range payload {
		payload[i] ^= mask[i%4]
	}
	return
}

var tunnelURL = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

// startTunnel runs cloudflared and reports the relay address it was given.
func startTunnel(ctx context.Context, port string) {
	cmd := exec.CommandContext(ctx, *cloudflared, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:"+port)
	stderr, err := cmd.StderrPipe()
	if err == nil {
		err = cmd.Start()
	}
	if err != nil {
		log.Printf("无法启动 cloudflared（%v）。请先安装：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/", err)
		return
	}
	go func() {
		s := bufio.NewScanner(stderr)
		found := false
		for s.Scan() {
			if u := tunnelURL.FindString(s.Text()); u != "" && !found {
				found = true
				host := strings.TrimPrefix(u, "https://")
				fmt.Printf("\n公网中继已就绪（临时地址，重启后会变化）：\n\n    bc+wss://%s/bc/\n\n在房间生成器或房间文件的「更换中继」中填写上面这一行。\n\n", host)
			}
		}
		cmd.Wait()
		if ctx.Err() == nil {
			log.Printf("cloudflared 已退出，公网地址失效")
		}
	}()
}

func main() {
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	h := &hub{topics: map[string]map[*conn]bool{}}
	srv := &http.Server{Addr: *listen, Handler: http.HandlerFunc(h.serveHTTP), ReadHeaderTimeout: 10 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("无法监听 %s：%v", *listen, err)
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	scheme := "ws"
	if *tlsCert != "" {
		scheme = "wss"
	}
	log.Printf("HTML Room broadcast relay %s listening on %s (%s://<host>:%s/bc/)", version, ln.Addr(), scheme, port)
	if *tunnel {
		startTunnel(ctx, port)
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	if *tlsCert != "" {
		err = srv.ServeTLS(ln, *tlsCert, *tlsKey)
	} else {
		err = srv.Serve(ln)
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
