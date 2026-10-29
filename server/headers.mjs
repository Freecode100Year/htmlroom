// Parse the shared static-asset header file for the Node relay.
export function parseHeaders(text) {
 const out={};
 for(const line of text.split(/\r?\n/)){
  const match=line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if(match)out[match[1]]=match[2].trim();
 }
 return out;
}
