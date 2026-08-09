---
layout: post
title: "Docker (3) - 컨테이너 병렬 실행(서로 다른 버전의 PostgreSQL)"
date: 2026-06-18 17:42:05 +0900
categories: ["Docker"]
tags: ["docker", "도커"]
---

> postgres:16과 postgres:18을 각각 다른 host port로 실행가능

### 1. PostgreSQL 16, 18 동시 실행
```
# 16 버전 실행
docker run -d \
  --name paperclip-pg16 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=paperclip \
  -p 15432:5432 \
  -v paperclip-pg16-data:/var/lib/postgresql/data \
  postgres:16

# 18 버전 실행
docker run -d \
  --name paperclip-pg18 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=paperclip \
  -p 15433:5432 \
  -v paperclip-pg18-data:/var/lib/postgresql \
  postgres:18
```
![](https://velog.velcdn.com/images/eta_kyung/post/ea840242-9b84-47bb-b60a-973af3f25e7d/image.png)

다른 host port가 각각 컨테이너의 5432포트로 포트포워딩이 되는 것을 확인할 수 있다. 

즉 컨테이너가 다르면 포트 번호를 같은 걸 쓸 수 있다. (둘다 각 컨테이너에서 5432포트)

host port번호는 구분이 되어야하므로 다른 포트 번호를 배정해야한다.
15432 -> 5432 
15433 -> 5432
