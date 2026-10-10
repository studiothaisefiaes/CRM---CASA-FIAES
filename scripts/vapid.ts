import webpush from "web-push";

// Gera o par de chaves VAPID do push no celular. Cole no .env do app e do worker (nunca no git).
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:contato@casafiaes.com.br`);
