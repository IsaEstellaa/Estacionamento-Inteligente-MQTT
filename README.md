# Estacionamento Inteligente MQTT
Sistema de estacionamento inteligente para campus universitário utilizando:

* MQTT para comunicação em tempo real
* HTTP REST API
* SQLite para persistência
* Node-RED para dashboard
* Simulação automática de sensores e gateways

## Tecnologias Utilizadas
Node.js

MQTT

Eclipse Mosquitto

SQLite

Node-RED

Docker

## Estrutura do Projeto

O sistema possui:

3 setores:
* A
* B
* C
  
30 vagas por setor:
* A-01 até A-30
* B-01 até B-30
* C-01 até C-30

Total:

* 90 sensores simulados
* 3 gateways simulados

## Como Rodar o Projeto
### 1. Iniciar o Node-RED
Em um terminal:
```
node-red
```

### 2. Iniciar o Broker MQTT (Mosquitto)
Em outro terminal:
```
docker run -it -p 1883:1883 -p 9001:9001 eclipse-mosquitto
```

### 3. Testar MQTT (Opcional)
Subscriber
```
docker exec -it <container_id> mosquitto_sub -h localhost -t "test/topic"
```

Publisher
```
docker exec -it <container_id> mosquitto_pub -h localhost -t "test/topic" -m "hello mqtt"
```

### 4. Iniciar o Backend
Em outro terminal:
```
node server.js
```

## Banco de Dados
Abrir terminal SQLite:
```
sqlite3 parking.db
```

## Endpoints da API
#### Mapa Atual
```
/api/v1/map
```
Retorna:

* setores
* vagas
* estado atual

#### Disponibilidade por Setor
```
/api/v1/sectors
```
Retorna:

* occupiedCount
* freeCount
* occupancyRate
* lastUpdateTs
* vagas

#### Vagas de um setor
```
/api/v1/sectors/[A, B ou C]/spots
```

#### Vagas livres de um setor
```
/api/v1/sectors/[A, B ou C]/free-spots?limit=10
```

#### Recomendações
Quando um setor estiver acima de 90% de ocupação, o sistema recomenda outro setor.
```
/api/v1/recommendation?fromSector=[A, B ou C]
```

#### Histórico de Recomendações
```
/api/v1/recommendations
```

#### Incidentes
Todos:
```
/api/v1/incidents
```
Somente abertos:
```
/api/v1/incidents?status=OPEN
```
Somente fechados:
```
/api/v1/incidents?status=CLOSED [sem dados]
```

#### Relatório de Rotatividade (Turnover)
```
/api/v1/reports/turnover?sectorId=A&from=2026-01-01T00:00:00.000Z&to=2030-01-01T23:59:59.000Z
```
Turnover:
* quantidade de transições FREE → OCCUPIED
* representa veículos atendidos no período

## MQTT
#### Tópico de Eventos
```
campus/parking/sectors/<sectorId>/spots/<spotId>/events
```

Exemplo:
```
campus/parking/sectors/A/spots/A-01/events
```
#### Tópico de Gateway
```
campus/parking/sectors/<sectorId>/gateway/status
```

## Simulação Manual via MQTT
Este projeto permite simular eventos de estacionamento diretamente via terminal usando MQTT.
#### Ocupar vaga
```
mosquitto_pub -h localhost \
-t "campus/parking/sectors/A/spots/A-01/events" \
-m '{
  "eventId":"1001",
  "ts":"2026-05-10T21:15:00Z",
  "sectorId":"A",
  "spotId":"A-01",
  "state":"OCCUPIED",
  "source":"sensor"
}'
```

#### Liberar vaga
```
mosquitto_pub -h localhost \
-t "campus/parking/sectors/A/spots/A-01/events" \
-m '{
  "eventId":"1002",
  "ts":"2026-05-10T21:15:01Z",
  "sectorId":"A",
  "spotId":"A-01",
  "state":"FREE",
  "source":"sensor"
}'
```
### Simulação de Falhas

#### Flapping
Troca rápida de estado:

```
mosquitto_pub -h localhost \
-t "campus/parking/sectors/A/spots/A-01/events" \
-m '{
  "eventId":"3",
  "ts":"2026-05-10T10:02:00Z",
  "sectorId":"A",
  "spotId":"A-01",
  "state":"OCCUPIED",
  "source":"terminal"
}'

aguarda 1 segundo

mosquitto_pub -h localhost \
-t "campus/parking/sectors/A/spots/A-01/events" \
-m '{
  "eventId":"4",
  "ts":"2026-05-10T10:02:01Z",
  "sectorId":"A",
  "spotId":"A-01",
  "state":"FREE",
  "source":"terminal"
}'
```

### Lotar um setor inteiro
```
for i in $(seq -w 1 30)
do
mosquitto_pub -h localhost \
-t "campus/parking/sectors/A/spots/A-$i/events" \
-m "{\"eventId\":\"$i\",\"ts\":\"2026-05-05T10:00:00Z\",\"sectorId\":\"A\",\"spotId\":\"A-$i\",\"state\":\"OCCUPIED\",\"source\":\"sensor\"}"
done
```

## Simulação Automática
O sistema possui uma simulação automática de um dia real:

* horários de pico
* chegada e saída de veículos
* ocupação dinâmica
* flapping raro
* incidentes automáticos

#### Iniciar
```
curl -X POST http://localhost:3000/api/v1/simulation/start
```

#### Parar
```
curl -X POST http://localhost:3000/api/v1/simulation/stop
```

## Gateways

Escutar status dos gateways:
```
mosquitto_sub -h localhost -t "campus/parking/sectors/+/gateway/status"
```

## Incidentes Detectados

O sistema detecta automaticamente:

* STUCK_OCCUPIED
* STUCK_FREE
* FLAPPING

Todos os incidentes:

* ficam persistidos no banco
* podem ser consultados via API
* aparecem em tempo real
