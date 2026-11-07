export const physicalDeviceId=device=>device.physicalDeviceId||device.id;
// Older servers return only the physical list. New snapshots retain it for all
// execution/remote paths and expose the independently arranged desks separately.
export const projectComputers=snapshot=>snapshot?.projectComputers??snapshot?.devices??[];
export function computerForSession(computers,deviceId,sessionId,computerId){
 const peers=computers.filter(d=>physicalDeviceId(d)===deviceId);
 return peers.find(d=>sessionId&&d.boundSessionId===sessionId)||peers.find(d=>d.id===computerId)||peers.find(d=>!d.boundSessionId)||peers[0];
}
export function computerWorkTarget(computers,target,sessions=[]){
 const sessionId=target.sessionId||target.id;
 const computer=computerForSession(computers,target.deviceId,sessionId,target.computerId||sessions.find(s=>s.id===sessionId)?.computerId);
 return computer?{...target,deviceId:computer.id}:target;
}
// Filter the session tree without changing physical execution/folder identities.
export function computerSnapshot(snapshot,computerId){
 if(!computerId)return snapshot;
 const computers=projectComputers(snapshot);
 return {...snapshot,sessions:snapshot.sessions.filter(s=>computerForSession(computers,s.deviceId,s.id,s.computerId)?.id===computerId)};
}
