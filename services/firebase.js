import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyDF6yEJ4EnpGy43hCZ3qXhuN0B_lanfJEs",
  authDomain: "escapethefire-f4bcd.firebaseapp.com",
  databaseURL: "https://escapethefire-f4bcd-default-rtdb.firebaseio.com",
  projectId: "escapethefire-f4bcd",
  storageBucket: "escapethefire-f4bcd.firebasestorage.app",
  messagingSenderId: "637226848188",
  appId: "1:637226848188:web:cc3c04203a0902a652a5b9"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

export default app;