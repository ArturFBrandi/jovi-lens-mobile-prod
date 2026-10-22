import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from './Icon.jsx';
import { dismissCreditsExhausted, FREE_CREDITS, useAiAccess } from '../services/aiAccess.js';
import { isDemoMode } from '../services/env.js';

// Shown over any screen when the server refuses an AI call with
// CREDITS_EXHAUSTED (prod-web-android-spec.md §4.4). A Modal, so it also
// appears above the photo sheet that made the call.
export default function CreditsExhaustedNotice() {
  const { creditsExhausted } = useAiAccess();
  const router = useRouter();
  if (Platform.OS === 'web' || isDemoMode()) return null;

  function addKey() {
    dismissCreditsExhausted();
    router.push('/(tabs)/profile');
  }

  return (
    <Modal visible={creditsExhausted} transparent animationType="fade" onRequestClose={dismissCreditsExhausted}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full gap-3 rounded-2xl bg-white p-5" accessibilityRole="alert">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-50">
            <Icon name="crown" size={20} color="#d97706" />
          </View>
          <Text className="text-[17px] font-bold text-slate-900">Interações gratuitas esgotadas</Text>
          <Text className="text-[14px] leading-5 text-slate-600">
            Você usou as {FREE_CREDITS} interações gratuitas desta conta. Adicione sua própria chave de IA para continuar usando sem limite.
          </Text>
          <View className="mt-1 flex-row gap-2">
            <Pressable accessibilityRole="button" onPress={dismissCreditsExhausted} className="flex-1 items-center rounded-xl border border-slate-200 py-3">
              <Text className="text-[14px] font-semibold text-slate-600">Agora não</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={addKey} className="flex-1 items-center rounded-xl bg-indigo-600 py-3">
              <Text className="text-[14px] font-semibold text-white">Adicionar minha chave</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
