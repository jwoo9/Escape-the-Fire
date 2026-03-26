import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, firebaseConfig } from './firebase';

export const login = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    throw error;
  }
};

export const createStaffAccount = async (email, password, name, role = 'staff') => {
  const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = userCredential.user.uid;
    await setDoc(doc(db, 'users', uid), {
      uid,
      name,
      email,
      role,
      createdAt: new Date(),
      active: true,
    });
    await secondaryAuth.signOut();
    await secondaryApp.delete();
    return uid;
  } catch (error) {
    await secondaryApp.delete();
    throw error;
  }
};

export const deactivateStaff = async (uid) => {
  await updateDoc(doc(db, 'users', uid), { active: false });
};

export const reactivateStaff = async (uid) => {
  await updateDoc(doc(db, 'users', uid), { active: true });
};