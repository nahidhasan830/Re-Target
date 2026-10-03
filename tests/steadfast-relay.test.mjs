import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import handler from '../infra/steadfast-transport/api/transport.mjs';
const nativeFetch = globalThis.fetch, previous = process.env.STEADFAST_TRANSPORT_TOKEN;
process.env.STEADFAST_TRANSPORT_TOKEN = 'relay-test-secret';
after(()=>{globalThis.fetch=nativeFetch;if(previous===undefined)delete process.env.STEADFAST_TRANSPORT_TOKEN;else process.env.STEADFAST_TRANSPORT_TOKEN=previous;});
async function request(body, authorization='Bearer relay-test-secret',method='POST') {
  const result={};
  const res={setHeader(){},status(status){result.status=status;return this;},json(data){result.data=data;return result;}};
  await handler({method,headers:{authorization},body},res);return result;
}
test('relay requires authentication and limits methods, origins, paths, cursor and headers',async()=>{
  const data={url:'https://steadfast.com.bd/user/consignment/status/delivered?cursor=opaque_value',method:'GET',headers:{accept:'text/html','cache-control':'no-cache',cookie:'session=test'}};
  let calls=0;globalThis.fetch=async url=>{calls++;const html=url.pathname.includes('/status/') ? '<script>window.Steadfast={"user_id":20}</script><main><table><tr><th>Consignment</th><th>Invoice</th><th>Recipient</th><th>Address</th><th>Status</th></tr><tr><td><a href="https://steadfast.com.bd/user/consignment/123">123</a></td><td>INV</td><td>Customer</td><td>Dhaka</td><td><span class="sf-badge">Delivered</span></td></tr></table></main>' : '<main><h1>Parcel #123</h1><section class="sf-parcel__card--recipient"><div class="sf-parcel__person"><b>Customer</b><p>Dhaka</p></div><ul class="sf-parcel__contacts"><li><span class="sf-parcel__contact-label">Phone</span><span class="sf-parcel__mono">01712345678</span></li></ul></section></main>';return new Response(html,{headers:{'Set-Cookie':'session=renewed; Path=/'}});};
  assert.equal((await request(data,'Bearer wrong')).status,401);
  assert.equal((await request(data,undefined,'GET')).status,405);
  for(const update of [{url:'https://evil.test/login'},{url:'https://steadfast.com.bd/logout'},{url:'https://steadfast.com.bd/user/consignment/status/delivered?page=2'},{url:'https://steadfast.com.bd/user/consignment/status/delivered?cursor=a&cursor=b'},{method:'POST'},{headers:{authorization:'secret'}}]) assert.equal((await request({...data,...update})).status,400);
  assert.equal(calls,0);
  assert.equal((await request(data)).data.status,200);
  assert.equal((await request({...data,url:'https://steadfast.com.bd/user/consignment/123'})).status,200);
  assert.equal(calls,2);
});
test('relay returns safe errors for upstream failures and oversized responses',async()=>{
  const data={url:'https://steadfast.com.bd/login',method:'GET',headers:{accept:'text/html'}};
  globalThis.fetch=async()=>{throw new Error('private session data');};
  let result=await request(data);assert.equal(result.status,502);assert.ok(!JSON.stringify(result).includes('private'));
  globalThis.fetch=async()=>new Response('x'.repeat(1024*1024+1));
  result=await request(data);assert.equal(result.status,502);
});
