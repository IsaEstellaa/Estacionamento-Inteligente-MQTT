const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  console.log('✅ Conectado ao broker MQTT');

  client.subscribe('campus/parking/#', () => {
    console.log('📡 Inscrito nos tópicos');
  });
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    console.log('📩 Evento recebido:');
    console.log({
      eventId: data.eventId,
      spotId: data.spotId,
      state: data.state,
      ts: data.ts
    });

  } catch (err) {
    console.error('❌ Erro ao processar mensagem:', err.message);
  }
});