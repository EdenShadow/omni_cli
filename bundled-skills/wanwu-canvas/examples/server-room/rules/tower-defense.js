globalThis.Room = {
  init() {return {kind:'tower-defense',time:0,gold:100,lives:10,wave:0,enemies:[],towers:[],players:{},nextSpawn:1,nextId:1};},
  join(s,p) {s.players[p.id]={seq:-1};},leave(s,p) {delete s.players[p.id];},
  input(s,p,m) {
    const player=s.players[p.id];
    if(!player||m?.type!=='build'||!Number.isSafeInteger(m.seq)||m.seq<=player.seq||!Number.isFinite(m.x))return {accepted:false};
    player.seq=m.seq;
    const x=Math.round(Math.max(10,Math.min(90,m.x))/10)*10;
    if(s.gold<25||s.towers.length>=8||s.towers.some(t=>t.x===x))return {accepted:false};
    s.gold-=25;s.towers.push({id:s.nextId++,x,readyAt:0,owner:p.id});return {accepted:true};
  },
  tick(s,ctx) {
    s.time+=ctx.dt;if(s.lives<=0)return;
    if(s.time>=s.nextSpawn&&s.enemies.length<24){s.wave++;s.enemies.push({id:s.nextId++,x:0,hp:30});s.nextSpawn=s.time+2;}
    for(const enemy of s.enemies)enemy.x+=8*ctx.dt;
    for(const tower of s.towers)if(s.time>=tower.readyAt){
      const enemy=s.enemies.find(e=>e.hp>0&&Math.abs(e.x-tower.x)<22);
      if(enemy){enemy.hp-=10;tower.readyAt=s.time+.5;ctx.emit('hit',{towerId:tower.id,enemyId:enemy.id});}
    }
    s.enemies=s.enemies.filter(e=>{if(e.hp<=0){s.gold+=8;return false;}if(e.x>=100){s.lives--;return false;}return true;});
  },
  query(s) {return {gold:s.gold,lives:s.lives,wave:s.wave};},
  view(s,p) {return {kind:s.kind,time:s.time,gold:s.gold,lives:s.lives,wave:s.wave,enemies:s.enemies,towers:s.towers,self:p.id};}
};
