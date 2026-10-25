// Rule file, not platform code. Clients send controls; server owns all movement.
globalThis.Room = {
  init(ctx) {
    return {kind:'race',time:0,players:{},laps:Math.max(1,Math.min(10,ctx.config.laps||3)),trackLength:Math.max(20,Math.min(1000,ctx.config.trackLength||120)),winner:null};
  },
  join(s,p) { s.players[p.id]={distance:0,lane:Object.keys(s.players).length%2*30,speed:0,throttle:0,steer:0,lastInput:-10,seq:-1,lap:0}; },
  leave(s,p) { delete s.players[p.id]; },
  input(s,p,m) {
    const car=s.players[p.id];
    if(!car||m?.type!=='drive'||!Number.isSafeInteger(m.seq)||m.seq<=car.seq||!Number.isFinite(m.throttle)||!Number.isFinite(m.steer))return {accepted:false};
    car.seq=m.seq;car.throttle=Math.max(-1,Math.min(1,m.throttle));car.steer=Math.max(-1,Math.min(1,m.steer));car.lastInput=s.time;
    return {accepted:true};
  },
  tick(s,ctx) {
    s.time+=ctx.dt;if(s.winner)return;
    for(const [id,c] of Object.entries(s.players)){
      if(s.time-c.lastInput>.5){c.throttle=0;c.steer=0;}
      c.speed=Math.max(0,Math.min(20,c.speed+(c.throttle*18-c.speed*.35)*ctx.dt));
      c.lane=Math.max(0,Math.min(60,c.lane+c.steer*20*ctx.dt));
      c.distance+=c.speed*ctx.dt;c.lap=Math.floor(c.distance/s.trackLength);
      if(c.lap>=s.laps&&!s.winner){s.winner=id;ctx.emit('finish',{playerId:id,time:s.time});}
    }
    const cars=Object.values(s.players);
    for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
      const a=cars[i],b=cars[j],raw=Math.abs(a.distance%s.trackLength-b.distance%s.trackLength),distance=Math.min(raw,s.trackLength-raw);
      if(distance<2&&Math.abs(a.lane-b.lane)<8){a.speed*=.8;b.speed*=.8;a.lane=Math.max(0,a.lane-2);b.lane=Math.min(60,b.lane+2);}
    }
  },
  query(s,p) {return s.players[p.id]||null;},
  view(s,p) {return {kind:s.kind,time:s.time,players:s.players,laps:s.laps,trackLength:s.trackLength,winner:s.winner,self:p.id};}
};
