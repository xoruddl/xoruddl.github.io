---
layout: post
title: "Docker (9) - Docker Hub 이미지 배포 테스트"
date: 2026-08-18 13:46:26 +0900
categories: ["Docker"]
tags: ["docker", "dockerhub", "mysql", "도커"]
---

## 1. 개요
직접 만든 이미지(`etakyung/for-docker-java:latest`)를 Docker Hub에 올려두기만 하고 끝내면, 이게 다른 환경에서도 제대로 동작하는지는 알 수가 없다. 그래서 이번에는 로컬에서 이 이미지를 다시 `pull` 받아, MySQL 컨테이너와 연결한 상태로 API까지 정상 호출되는지 직접 확인해봤다.

로컬에서 빌드한 이미지가 아니라 Docker Hub에서 받아온 이미지로 테스트한다는 점, 그리고 앱과 DB를 서로 다른 컨테이너로 띄워서 네트워크로 연결한다는 점이 이번 테스트의 핵심이다.

---

## 2. 네트워크 생성 및 MySQL 컨테이너 실행
앱 컨테이너와 DB 컨테이너가 컨테이너 이름으로 서로를 찾을 수 있어야 하므로, 먼저 사용자 정의 네트워크를 만들고 그 안에 MySQL을 띄운다.

```bash
docker network create for-java-net

docker run -d --name mysql-test \
  --network for-java-net \
  -e MYSQL_DATABASE=itemdb \
  -e MYSQL_USER=user1 \
  -e MYSQL_PASSWORD=1234 \
  -e MYSQL_ROOT_PASSWORD=1234 \
  mysql:8.4
```

MySQL 컨테이너가 완전히 초기화되기 전에 앱을 붙이면 연결에 실패할 수 있으므로, 로그로 초기화가 끝났는지 먼저 확인했다.

```bash
docker logs -f mysql-test
```

로그에 `ready for connections`가 찍히는 걸 확인한 뒤 `Ctrl+C`로 로그 확인을 종료했다.

---

## 3. 이미지 pull 및 앱 컨테이너 실행
Docker Hub에 올려둔 이미지를 pull 받고, 같은 네트워크에서 MySQL 컨테이너 이름(`mysql-test`)을 호스트로 지정해 앱 컨테이너를 실행한다.

```bash
docker pull etakyung/for-docker-java:latest

docker run -d --name app-test \
  --network for-java-net \
  -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:mysql://mysql-test:3306/itemdb \
  -e SPRING_DATASOURCE_USERNAME=user1 \
  -e SPRING_DATASOURCE_PASSWORD=1234 \
  etakyung/for-docker-java:latest
```

같은 네트워크 안에 있는 컨테이너끼리는 IP 대신 컨테이너 이름으로 통신할 수 있기 때문에, `SPRING_DATASOURCE_URL`에 IP가 아닌 `mysql-test`라는 이름을 그대로 넣을 수 있었다. 앱이 정상적으로 뜨는지는 아래 로그로 확인했다.

```bash
docker logs -f app-test
```

`Started ForDockerApplication` 로그가 찍히면 앱이 MySQL과의 연결까지 마치고 정상 기동된 것이다.

---

## 4. API 동작 확인
앱이 뜬 뒤에는 실제로 아이템을 등록하고 조회하는 API를 호출해서 DB 연동까지 제대로 되는지 확인했다.

```bash
curl -X POST http://localhost:8080/api/items \
  -H "Content-Type: application/json" \
  -d '{"name":"test-item","description":"docker hub test"}'

curl http://localhost:8080/api/items
```

POST로 등록한 아이템이 GET 조회 결과에 그대로 나오면, Docker Hub에서 받은 이미지 → 컨테이너 실행 → MySQL 연동까지 전체 플로우가 문제없이 동작한다는 뜻이다.

![GET /api/items 응답 결과](/assets/img/posts/2026-08-18-Docker-9-DockerHub-이미지-배포-테스트/image.png)
_POST로 등록한 아이템이 GET 조회 결과에 그대로 반영된 모습_

---

## 5. 정리 및 컨테이너 삭제
테스트가 끝난 뒤에는 사용한 컨테이너와 네트워크를 정리했다.

```bash
docker rm -f app-test mysql-test
docker network rm for-java-net
```

컨테이너는 `-f` 옵션으로 실행 중이어도 바로 삭제했고, 네트워크는 이걸 물고 있던 컨테이너를 먼저 지운 뒤에야 삭제할 수 있었다.

---

## 6. 정리
이번 테스트로 Docker Hub에 올린 이미지가 로컬 빌드 환경이 아닌 별도 환경에서도 pull만으로 동일하게 동작한다는 걸 확인할 수 있었다. 앱과 DB를 서로 다른 컨테이너로 분리하더라도, 같은 사용자 정의 네트워크에 올려두면 컨테이너 이름을 그대로 호스트처럼 써서 연결할 수 있다는 점도 다시 한번 체감했다.

이런 식으로 이미지를 배포하기 전에 실제 pull 환경을 흉내 내서 테스트해두면, 로컬에서만 잘 되던 이미지가 다른 곳에서는 안 뜨는 문제를 미리 걸러낼 수 있다.
