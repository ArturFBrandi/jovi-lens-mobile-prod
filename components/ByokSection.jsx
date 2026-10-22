import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Icon from './Icon.jsx';
import { BYOK_PROVIDERS, providerLabel, removeByok, saveByok, useAiAccess } from '../services/aiAccess.js';
import { confirmAction } from '../services/confirm.js';

// "Usar minha própria chave" inside Perfil's Copilot card (Android only,
// prod-web-android-spec.md §4.5). The key is validated by the server, then kept
// only in secure storage on this phone.
export default function ByokSection({ onMessage }) {
  const { byok } = useAiAccess();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setOpen(false);
    setApiKey('');
    setError('');
  }

  async function save() {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await saveByok(provider, apiKey);
      close();
      onMessage?.('Chave validada e salva neste aparelho.');
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível validar a chave.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const confirmed = await confirmAction({
      title: 'Remover chave',
      message: 'Remover sua chave de IA deste aparelho?',
      confirmLabel: 'Remover',
      destructive: true,
    });
    if (!confirmed) return;
    await removeByok();
    onMessage?.('Chave removida deste aparelho.');
  }

  if (!open) {
    return byok ? (
      <View className="gap-2">
        <View className="flex-row items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
          <Icon name="check" size={15} color="#16a34a" />
          <Text className="flex-1 text-[13px] font-medium text-emerald-700">{providerLabel(byok.provider)} · {byok.masked}</Text>
        </View>
        <View className="flex-row gap-2">
          <Pressable accessibilityRole="button" onPress={() => setOpen(true)} className="flex-1 items-center rounded-xl border border-slate-200 py-3">
            <Text className="text-[14px] font-semibold text-slate-600">Trocar chave</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={remove} className="flex-1 items-center rounded-xl border border-red-200 bg-red-50 py-3">
            <Text className="text-[14px] font-semibold text-red-600">Remover chave</Text>
          </Pressable>
        </View>
      </View>
    ) : (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} className="items-center rounded-xl border border-slate-200 py-3">
        <Text className="text-[14px] font-semibold text-slate-600">Usar minha própria chave</Text>
      </Pressable>
    );
  }

  const hint = BYOK_PROVIDERS.find((item) => item.value === provider)?.hint;
  return (
    <View className="gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <Text className="text-[12px] font-semibold text-slate-600">Provedor de IA</Text>
      <View className="flex-row flex-wrap gap-1.5" accessibilityLabel="Provedor de IA">
        {BYOK_PROVIDERS.map((option) => {
          const active = option.value === provider;
          return (
            <Pressable
              accessibilityRole="button"
              key={option.value}
              onPress={() => setProvider(option.value)}
              accessibilityState={{ selected: active }}
              className={`rounded-full border px-3 py-1.5 ${active ? 'border-indigo-600 bg-indigo-600' : 'border-slate-200 bg-white'}`}
            >
              <Text className={`text-[12px] font-medium ${active ? 'text-white' : 'text-slate-600'}`}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text className="text-[11px] leading-4 text-slate-500">{hint}</Text> : null}
      <View className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <TextInput
          accessibilityLabel="Chave de IA"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="Cole sua chave aqui"
          placeholderTextColor="#94a3b8"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          className="text-[14px] text-slate-900"
        />
      </View>
      {error ? (
        <View className="rounded-xl bg-red-50 px-3 py-2.5" accessibilityRole="alert">
          <Text className="text-[13px] text-red-600">{error}</Text>
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={close} className="flex-1 items-center rounded-xl border border-slate-200 bg-white py-3">
          <Text className="text-[14px] font-semibold text-slate-600">Cancelar</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy || !apiKey.trim()} onPress={save} className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-3 ${busy || !apiKey.trim() ? 'bg-indigo-300' : 'bg-indigo-600'}`}>
          {busy ? <ActivityIndicator size="small" color="#ffffff" /> : null}
          <Text className="text-[14px] font-semibold text-white">{busy ? 'Validando…' : 'Validar e salvar'}</Text>
        </Pressable>
      </View>
      <Text className="text-[11px] leading-4 text-slate-400">Sua chave fica criptografada neste aparelho e é enviada apenas para processar cada pedido; o JOVI Lens não a armazena. O uso é cobrado na sua conta do provedor.</Text>
    </View>
  );
}
