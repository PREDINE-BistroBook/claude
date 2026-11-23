/**
 * A fresh VAPID key pair for Web Push (the team pack's notifications to
 * phones):
 *
 *   npm run vapid-keys
 *
 * Set VAPID_PUBLIC_KEY as a var and VAPID_PRIVATE_KEY as a secret on the
 * Worker (or both as environment variables on the Node server). Generate the
 * pair once: changing it later means every phone has to turn notifications on
 * again. Prints the keys only; nothing is stored or sent anywhere.
 */
import { generateVapidKeys } from '../src/server/lib/push/keys';

const keys = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
