// Roomie+ sync adapter. Bundled into public/sync.js with:  npm run build
// It gives app.js the same small storage surface the app was written against:
//   db.collection(name).limit(n).onSnapshot(next, error)
//   db.collection(name).doc(id).set(body) / .update(patch) / .delete()
// Everything for one household lives under  households/{code}/{collection}/{doc}.
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, query, limit
} from 'firebase/firestore';

window.RoomieSync = {
  async connect(config, householdCode, onWriteError) {
    const app = initializeApp(config);
    const auth = getAuth(app);

    // Every phone signs in anonymously; the Firestore rules only let signed-in apps read or write.
    const user = await new Promise((resolve, reject) => {
      const off = onAuthStateChanged(auth, u => {
        if (u) { off(); resolve(u); }
        else signInAnonymously(auth).catch(e => { off(); reject(e); });
      }, reject);
    });

    // Keep a copy on the phone so the app opens and accepts changes offline, then syncs.
    let fs;
    try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
    catch { fs = initializeFirestore(app, {}); }

    const fail = e => { try { onWriteError(e); } catch {} };
    // Writes resolve straight away: Firestore applies them locally at once and sends them when online.
    const fire = p => { p.catch(fail); return Promise.resolve(); };

    const db = {
      collection(name) {
        const cref = collection(fs, 'households', householdCode, name);
        return {
          limit(n) {
            return {
              onSnapshot(next, error) {
                let delivered = false, timer = null;
                const send = s => {
                  delivered = true; clearTimeout(timer);
                  next({ docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })) });
                };
                return onSnapshot(query(cref, limit(n)), { includeMetadataChanges: true }, s => {
                  // An empty answer from the on-phone copy is not proof the household is empty:
                  // wait for the server (or 4 seconds when offline) before saying so.
                  if (!delivered && s.metadata.fromCache && s.empty) {
                    clearTimeout(timer); timer = setTimeout(() => send(s), 4000); return;
                  }
                  if (delivered && s.docChanges().length === 0) return;   // nothing but sync bookkeeping changed
                  send(s);
                }, error);
              }
            };
          },
          doc(id) {
            const dref = doc(cref, id);
            return {
              set: body => fire(setDoc(dref, body)),
              update: patch => fire(setDoc(dref, patch, { merge: true })),   // nested maps merge
              delete: () => fire(deleteDoc(dref))
            };
          }
        };
      }
    };
    return { uid: user.uid, db };
  }
};
