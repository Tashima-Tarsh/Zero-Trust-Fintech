'use strict';
/** Temporary controlled write freeze while SQLite is archived and imported. */
const http=require('node:http');
const port=Number(process.env.PORT||8080);
http.createServer((req,res)=>{
  if(req.url==='/health'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({status:'maintenance',healthy:true,checkoutWrites:false}));
  }
  res.writeHead(503,{
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
    'Retry-After':'120'
  });
  res.end(JSON.stringify({
    success:false,
    error:'CHECKOUT_TEMPORARILY_UNAVAILABLE',
    message:'Payment services are temporarily paused for a database migration.'
  }));
}).listen(port,'0.0.0.0',()=>console.log('MAINTENANCE_WRITE_FREEZE_ACTIVE port='+port));
