import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Icon from './Icon.jsx';
import { getTesterState, initTesterAccess, subscribeTesterState, testerGateActive, unlock } from '../services/testerAccess.js';

// Production web build only (prod-web-android-spec.md §3.2, difference P5):
// the app stays behind this screen until the tester cookie is accepted. Every
// other build renders its children directly.
export default function TesterGate({ children }) {
  const active = testerGateActive();
  const [state, setState] = useState(() => (active ? getTesterState() : 'unlocked'));

  useEffect(() => {
    if (!active) return undefined;
    const unsubscribe = subscribeTesterState(setState);
    initTesterAccess().catch(() => {});
    return unsubscribe;
  }, [active]);

  if (state === 'unlocked') return children;
  if (state === 'unknown') {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#4f46e5" />
      </View>
    );
  }
  return <AccessScreen />;
}

function AccessScreen() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await unlock(code);
    } catch (unlockError) {
      setError(unlockError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 items-center justify-center bg-white px-8">
      <View className="w-full max-w-[360px] items-center gap-3">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-indigo-100">
          <Icon name="lock" size={24} color="#4f46e5" />
        </View>
        <Text className="text-center text-[19px] font-bold text-slate-900">Acesso de teste</Text>
        <Text className="text-center text-[13px] leading-5 text-slate-600">Digite o código de acesso que você recebeu para usar o JOVI Lens.</Text>
        <View className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <TextInput
            accessibilityLabel="Código de acesso"
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submit}
            placeholder="Código de acesso"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            maxLength={100}
            className="text-[15px] text-slate-900"
          />
        </View>
        {error ? (
          <View className="w-full rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert">
            <Text className="text-[13px] text-red-600">{error}</Text>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" disabled={busy || !code.trim()} onPress={submit} className={`w-full flex-row items-center justify-center gap-1.5 rounded-xl py-3 ${busy || !code.trim() ? 'bg-indigo-300' : 'bg-indigo-600'}`}>
          {busy ? <ActivityIndicator size="small" color="#ffffff" /> : <Icon name="check" size={16} color="#ffffff" />}
          <Text className="text-[14px] font-semibold text-white">Entrar</Text>
        </Pressable>
      </View>
    </View>
  );
}
