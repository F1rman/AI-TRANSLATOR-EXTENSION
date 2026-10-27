import type { BillingEnvironment, CreateJob } from './protocol';

export interface TextDraft { input: string; output: string }
export function textSessionKeys(environment: BillingEnvironment, uid: string) {
  const scope = JSON.stringify([environment, uid]);
  return { draft: `textDraft:${scope}`, pending: `pendingText:${scope}` };
}
export async function readTextSession(environment: BillingEnvironment, uid: string) {
  const keys = textSessionKeys(environment, uid);
  const stored = await chrome.storage.session.get([keys.draft, keys.pending]);
  return { draft: stored[keys.draft] as TextDraft | undefined, pending: stored[keys.pending] as CreateJob | undefined };
}
export async function saveTextDraft(environment: BillingEnvironment, uid: string, draft: TextDraft) {
  await chrome.storage.session.set({ [textSessionKeys(environment, uid).draft]: draft });
}
export async function savePendingText(environment: BillingEnvironment, uid: string, pending: CreateJob) {
  const keys = textSessionKeys(environment, uid);
  await chrome.storage.session.set({ [keys.pending]: pending, [keys.draft]: { input: pending.segments[0].text, output: '' } });
}
export async function removePendingText(environment: BillingEnvironment, uid: string) {
  await chrome.storage.session.remove(textSessionKeys(environment, uid).pending);
}
