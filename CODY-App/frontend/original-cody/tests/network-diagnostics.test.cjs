'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {IslandMonitors,monitorCommand,diagnoseConnection}=require('../src/island-monitors');
test('diagnostics distinguish Wi-Fi link rate from actual internet speeds',()=>{
 const reply=diagnoseConnection({wifi:{connected:true,ssid:'Home',signal:33,receiveMbps:866},rx:5.2,tx:1.1,latency:22});
 assert.match(reply,/weak signal/);assert.match(reply,/866 Mbps is the router connection, not Internet/);
 assert.match(reply,/activity, not maximum speed/);assert.match(reply,/22 ms/);
});
test('diagnostics suggest safe recovery when Wi-Fi is disconnected or unknown',()=>{
 assert.match(diagnoseConnection({wifi:{connected:false}}),/flight mode/);
 assert.match(diagnoseConnection({stale:true}),/current Wi-Fi reading/);
});
test('diagnostics never automatically run a speedtest',async()=>{
 const monitor=Object.create(IslandMonitors.prototype);
 monitor.data={wifi:{connected:true,ssid:'Test',signal:72,linkMbps:600}};
 monitor.windowsUpdatedAt=10;monitor.now=()=>11;monitor.rx=2;monitor.tx=1;
 monitor.speedTest=()=>{throw Error('must not start')};
 assert.equal(monitorCommand('diagnose my wifi').action,'diagnose');
 const result=await monitor.execute({action:'diagnose'});
 assert.match(result.reply,/Connected to Test/);
 assert.equal(monitorCommand('speed test').action,'speedtest');
});
