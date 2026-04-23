import { Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../../services/firebase';

export default function LoginScreen() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    setError('');
    if (!email || !password) { setError('Email and password are required.'); return; }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      // Surface a clean message rather than Firebase's raw error string
      const msg: Record<string, string> = {
        'auth/invalid-credential':     'Incorrect email or password.',
        'auth/user-not-found':         'No account found with that email.',
        'auth/wrong-password':         'Incorrect password.',
        'auth/too-many-requests':      'Too many attempts. Try again later.',
        'auth/network-request-failed': 'Network error. Check your connection.',
      };
      setError(msg[err.code] ?? 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.inner}>

          {/* ── Branding ── */}
          <View style={s.brand}>
            <View style={s.iconWrap}>
              <Ionicons name="flame" size={30} color="#ef4444" />
            </View>
            <Text style={s.appName}>EVACU<Text style={s.appNameAccent}>APP</Text></Text>
            <Text style={s.tagline}>Emergency Evacuation System</Text>
          </View>

          {/* ── Form card ── */}
          <View style={s.card}>
            <Text style={s.cardHeading}>Staff Sign In</Text>

            {/* Inline error */}
            {!!error && (
              <View style={s.errorBanner}>
                <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Email */}
            <Text style={s.label}>EMAIL</Text>
            <View style={s.inputWrap}>
              <Ionicons name="mail-outline" size={16} color="#64748b" style={s.inputIcon} />
              <TextInput
                style={s.input}
                value={email}
                onChangeText={v => { setEmail(v); setError(''); }}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@organization.com"
                placeholderTextColor="#475569"
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <Text style={s.label}>PASSWORD</Text>
            <View style={s.inputWrap}>
              <Ionicons name="lock-closed-outline" size={16} color="#64748b" style={s.inputIcon} />
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={password}
                onChangeText={v => { setPassword(v); setError(''); }}
                secureTextEntry={!showPass}
                placeholder="••••••••"
                placeholderTextColor="#475569"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPass(v => !v)} style={s.eyeBtn}>
                <Ionicons
                  name={showPass ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color="#64748b"
                />
              </TouchableOpacity>
            </View>

            {/* Sign in button */}
            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.btnText}>Sign In</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Footer ── */}
          <Text style={s.footer}>
            Authorized personnel only.{'\n'}Contact your administrator for access.
          </Text>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#0f172a' },
  flex:         { flex: 1 },
  inner:        { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 24 },

  // Branding
  brand:        { alignItems: 'center', marginBottom: 36 },
  iconWrap:     { width: 64, height: 64, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#ef444430', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  appName:      { fontSize: 28, fontWeight: '800', color: '#f1f5f9', letterSpacing: 4 },
  appNameAccent:{ color: '#ef4444' },
  tagline:      { fontSize: 12, color: '#475569', marginTop: 6, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '500' },

  // Card
  card:         { backgroundColor: '#1e293b', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#334155', gap: 6 },
  cardHeading:  { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 8 },

  // Error
  errorBanner:  { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#450a0a', borderRadius: 10, padding: 11, borderWidth: 1, borderColor: '#7f1d1d', marginBottom: 4 },
  errorText:    { color: '#fca5a5', fontSize: 13, flex: 1, lineHeight: 18 },

  // Fields
  label:        { fontSize: 10, fontWeight: '700', color: '#475569', letterSpacing: 1.5, marginTop: 8, marginBottom: 6 },
  inputWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 14 },
  inputIcon:    { marginRight: 10 },
  input:        { color: '#f1f5f9', fontSize: 15, paddingVertical: 14 },
  eyeBtn:       { padding: 4, marginLeft: 8 },

  // Button
  btn:          { backgroundColor: '#ef4444', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  btnDisabled:  { opacity: 0.6 },
  btnText:      { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.3 },

  // Footer
  footer:       { textAlign: 'center', color: '#334155', fontSize: 12, lineHeight: 18, marginTop: 32 },
});