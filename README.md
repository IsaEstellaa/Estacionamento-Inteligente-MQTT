# Estacionamento-Inteligente-MQTT


## rodar
em um terminal
node-red

outro
docker run -it -p 1883:1883 -p 9001:9001 eclipse-mosquitto

outro
docker exec -it <container_id> mosquitto_sub -h localhost -t "test/topic"

outro
docker exec -it <container_id> mosquitto_pub -h localhost -t "test/topic" -m "hello mqtt"

## Endpoints até agora

/api/v1/map

/api/v1/sectors

/api/v1/sectors/[A, B ou C]/free-spots

/api/v1/incidents

/api/v1/recommendation?fromSector=[A, B ou C]