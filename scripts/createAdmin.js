/**
 * Create Admin Account Script
 * 
 * Usage: 
 *   node scripts/createAdmin.js <email> <password> <name>
 * 
 * Example:
 *   node scripts/createAdmin.js admin@bgclub.org SecurePass123 "Club Admin"
 * 
 * This creates a Firebase Auth user and a Firestore 'users' document
 * with role='admin' and active=true.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDF6yEJ4EnpGy43hCZ3qXhuN0B_lanfJEs",
  authDomain: "escapethefire-f4bcd.firebaseapp.com",
  databaseURL: "https://escapethefire-f4bcd-default-rtdb.firebaseio.com",
  projectId: "escapethefire-f4bcd",
  storageBucket: "escapethefire-f4bcd.firebasestorage.app",
  messagingSenderId: "637226848188",
  appId: "1:637226848188:web:cc3c04203a0902a652a5b9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const args = process.argv.slice(2);
const email = args[0] || 'admin@bgclub.org';
const password = args[1] || 'admin123';
const name = args[2] || 'Admin';

async function createAdmin() {
  try {
    console.log(`Creating admin account for ${email}...`);
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    await setDoc(doc(db, 'users', uid), {
      uid,
      name,
      email,
      role: 'admin',
      createdAt: new Date().toISOString(),
      active: true,
    });

    console.log(`Admin account created successfully!`);
    console.log(`  UID:   ${uid}`);
    console.log(`  Email: ${email}`);
    console.log(`  Name:  ${name}`);
    console.log(`  Role:  admin`);
    process.exit(0);
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      console.error(`Error: Email ${email} is already registered.`);
    } else {
      console.error('Error creating admin:', error.message);
    }
    process.exit(1);
  }
}

createAdmin();
