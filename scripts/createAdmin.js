import { createStaffAccount } from '../services/auth.js';

const email = 'your-email@example.com';
const password = 'your-password';
const name = 'Admin';
const role = 'admin';

createStaffAccount(email, password, name, role)
  .then((uid) => {
    console.log('User created successfully with UID:', uid);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error creating user:', error.message);
    process.exit(1);
  });
