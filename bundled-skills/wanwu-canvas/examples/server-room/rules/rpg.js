globalThis.Room = {
  init() {return {kind:'rpg',time:0,players:{},enemy:{hp:100,maxHp:100,respawnAt:0},nextStrike:2};},
  join(s,p) {s.players[p.id]={hp:100,gold:0,nextAttack:0,seq:-1};},
  leave(s,p) {delete s.players[p.id];},
  input(s,p,m,ctx) {
    const hero=s.players[p.id];
    if(!hero||!Number.isSafeInteger(m?.seq)||m.seq<=hero.seq)return {accepted:false};
    hero.seq=m.seq;
    if(m.type==='attack'&&hero.hp>0&&s.enemy.hp>0&&s.time>=hero.nextAttack){
      hero.nextAttack=s.time+.6;s.enemy.hp=Math.max(0,s.enemy.hp-15);
      if(!s.enemy.hp){hero.gold+=10;s.enemy.respawnAt=s.time+3;ctx.emit('loot',{playerId:p.id,gold:10});}
      return {accepted:true};
    }
    if(m.type==='heal'&&hero.gold>=5){hero.gold-=5;hero.hp=Math.min(100,hero.hp+40);return {accepted:true};}
    return {accepted:false};
  },
  tick(s,ctx) {
    s.time+=ctx.dt;
    if(!s.enemy.hp&&s.time>=s.enemy.respawnAt)s.enemy.hp=s.enemy.maxHp;
    if(s.enemy.hp&&s.time>=s.nextStrike){s.nextStrike=s.time+2;for(const p of Object.values(s.players))p.hp=Math.max(0,p.hp-3);}
  },
  query(s,p) {return s.players[p.id]||null;},
  view(s,p) {return {kind:s.kind,time:s.time,players:s.players,enemy:{hp:s.enemy.hp,maxHp:s.enemy.maxHp},self:p.id};}
};
