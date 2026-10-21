import { it, expect } from "vitest";
import { isAllowedPushEndpoint } from "./push-endpoint";

it("aceita só os serviços de push conhecidos, em https", () => {
  for (const u of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QAbc",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://autopush.push.services.mozilla.com/x",
  ]) expect(isAllowedPushEndpoint(u), u).toBe(true);
  for (const u of [
    "http://fcm.googleapis.com/x", "https://evil.com/x", "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com/x", "https://push.apple.com.evil.com/x", "https://localhost/x", "https://169.254.169.254/x",
    "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "nao-e-url",
  ]) expect(isAllowedPushEndpoint(u), u).toBe(false);
});
