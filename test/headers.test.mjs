import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeaders } from '../server/headers.mjs';

test('security headers load identically from LF and Windows CRLF files', () => {
 const lines=['/*',"  Content-Security-Policy: default-src 'self'",'  Cache-Control: no-store',
  '  Referrer-Policy: no-referrer','  NEL: {"max_age":0}',''];
 for(const newline of ['\n','\r\n'])assert.deepEqual(parseHeaders(lines.join(newline)),{
  'Content-Security-Policy':"default-src 'self'",'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',NEL:'{"max_age":0}'
 });
});
