import { Store } from "../core/store.js";
import type { ChannelName } from "../types.js";

export async function runPairingApprove(channel: ChannelName, code: string): Promise<void> {
  const store = await Store.open();
  try {
    const ok = store.approvePairing(channel, code);
    if (!ok) {
      throw new Error("No pending pairing found for that channel/code.");
    }
    process.stdout.write("Pairing approved.\n");
  } finally {
    store.close();
  }
}

