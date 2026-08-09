---
layout: post
title: "Docker (5) - network"
date: 2026-06-20 23:30:49 +0900
categories: ["Docker"]
tags: ["docker", "도커"]
---

# Docker network
Docker network는 컨테이너들이 서로 통신하는 공간이다.
host에서 접속하려면 port publish가 필요하지만, 같은 Docker network 안의 컨테이너끼리는 container name으로 통신할 수 있다.

별도 네트워크를 지정하지 않으면 기본 네트워크에 연결된다.

# 간단한 테스트 명령어
```
docker network create myapp-network
```
```
docker run -d \
  --name myapp-postgres \
  --network myapp-network \
  -e POSTGRES_PASSWORD=postgres \
  -v myapp-pg-data:/var/lib/postgresql/data \
  postgres:16
```
```
docker run --rm \
  --network myapp-network \
  postgres:16 \
  pg_isready -h myapp-postgres -U postgres
```
<예상 결과>
![](https://velog.velcdn.com/images/eta_kyung/post/4b1ecbd9-9620-4816-be69-8ed9f0be79c8/image.png)

```
docker run --rm \
  --network myapp-network \
  -e PGPASSWORD=postgres \
  postgres:16 \
  psql -h myapp-postgres -U postgres -d postgres -c "SELECT current_database();"
```
<예상 결과>
![](https://velog.velcdn.com/images/eta_kyung/post/34493b49-185d-4c41-bb3a-d5ac4d201414/image.png)


# network 장점
- docker network create로 직접 만든 네트워크에서는 도커가 내장 DNS를 제공한다.

- 컨테이너 이름으로 통신 가능:
db:5432처럼 이름으로 바로 접근할 수 있어서 IP를 외울 필요가 없다.

- 기본 bridge도 통신은 되지만, 이름 기반 통신(DNS)과 네트워크 격리가 안 되기 때문에 사용자 정의 네트워크를 따로 만들어 쓰는 것이 실무에서의 표준이다.

- docker-compose를 쓰면 이 사용자 정의 네트워크가 자동으로 생성되기 때문에, compose 환경에서는 서비스 이름으로 바로 통신이 가능한 것도 같은 이유이다.
