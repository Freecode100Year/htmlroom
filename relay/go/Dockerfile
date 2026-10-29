# docker build -t htmlroom-relay relay/go && docker run -p 8080:8080 htmlroom-relay
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /htmlroom-relay .
FROM scratch
COPY --from=build /htmlroom-relay /htmlroom-relay
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/htmlroom-relay"]
