import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// 환경 변수에서 Firebase 설정 로드
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
};

// 디버그: 환경 변수 로드 확인
console.log('[Firebase] Config loaded:', {
  apiKey: firebaseConfig.apiKey ? '✓ set' : '✗ missing',
  authDomain: firebaseConfig.authDomain ? '✓ set' : '✗ missing',
  projectId: firebaseConfig.projectId ? '✓ set' : '✗ missing',
});

// 환경 변수 검증
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('[Firebase] ❌ Missing required environment variables. Please check your .env file.');
  console.error('[Firebase] Make sure VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID are set.');
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

console.log('[Firebase] ✓ App initialized successfully');

// 로그인 상태 유지 설정 (Electron 환경 대비 명시적 설정)
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('[Firebase] Persistence error:', error);
});

export const db = getFirestore(app);
export default app;
