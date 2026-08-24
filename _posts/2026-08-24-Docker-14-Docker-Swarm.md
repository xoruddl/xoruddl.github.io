---
layout: post
title: "Docker (14) - Docker Swarm으로 클러스터 서비스 운영하기"
date: 2026-08-24 23:50:19 +0900
categories: ["Docker"]
tags: ["docker", "docker swarm", "컨테이너", "오케스트레이션", "클러스터"]
---

Docker Compose는 한 대의 호스트에서 여러 컨테이너를 함께 실행하고 관리하기에 편리하다. 그러나 서비스 복제본을 여러 서버에 나누어 배치하고, 서버나 컨테이너에 장애가 나도 원하는 개수를 유지하며, 무중단에 가깝게 버전을 교체하려면 클러스터 수준의 관리가 필요하다.

**Docker Swarm mode**는 Docker Engine에 내장된 컨테이너 오케스트레이션 기능이다. 여러 Docker 호스트를 하나의 Swarm 클러스터로 묶고, 서비스의 원하는 상태를 선언하면 매니저 노드가 컨테이너 배치·확장·복구·업데이트를 조정한다.

---

## 1. Docker Swarm의 핵심 개념

Swarm에는 클러스터 관리 역할을 맡는 **manager node**와 실제 작업을 실행하는 **worker node**가 있다. manager는 클러스터 상태를 저장하고, 서비스를 어느 노드에 배치할지 결정하며, 서비스 API를 제공한다. manager가 여러 대라면 그중 하나가 leader가 되어 관리 상태를 조정한다.

기본적으로 manager도 worker처럼 서비스를 실행할 수 있다. 관리 작업에 자원을 집중하고 싶다면 manager의 가용성을 `drain`으로 바꾸거나 서비스에 배치 제약 조건을 지정해 작업이 올라가지 않게 할 수 있다.

| 용어 | 의미 |
| --- | --- |
| node | Swarm에 참여한 Docker Engine이 실행 중인 물리 서버 또는 가상 머신 |
| manager node | 클러스터 상태 유지, 서비스 스케줄링, API 제공을 담당하는 노드 |
| worker node | manager가 배정한 task를 실행하고 상태를 보고하는 노드 |
| service | 어떤 이미지를 몇 개 실행할지 정의한 배포 단위 |
| task | service에 속해 실행되는 개별 컨테이너 작업 |
| stack | 여러 service, network, volume을 하나의 애플리케이션 단위로 묶은 것 |

Docker Compose와 Swarm은 모두 Compose 형식의 YAML을 활용할 수 있지만 목적이 다르다.

| 구분 | Docker Compose | Docker Swarm |
| --- | --- | --- |
| 주 사용 환경 | 로컬 개발·테스트, 단일 호스트 | 여러 호스트로 구성한 클러스터 |
| 실행 단위 | 컨테이너 | service와 task |
| 확장 | 보통 단일 호스트 안에서 실행 | 여러 노드에 복제본을 분산 배치 |
| 배포 명령 | `docker compose up` | `docker service create`, `docker stack deploy` |

---

## 2. Swarm 클러스터 구성하기

실습을 위해 서로 통신할 수 있는 Linux 가상 머신 3대를 준비한다. 한 대는 manager, 나머지 두 대는 worker로 사용하며 모든 머신에 Docker Engine을 설치한다. manager의 IP는 다른 노드가 계속 접근해야 하므로 고정 IP를 사용하는 편이 좋다.

노드 사이 방화벽에는 다음 포트를 허용해야 한다.

| 포트·프로토콜 | 용도 |
| --- | --- |
| `2377/tcp` | Swarm 관리 통신 |
| `7946/tcp`, `7946/udp` | 노드 및 컨테이너 네트워크 검색 |
| `4789/udp` | Overlay Network 데이터 경로(VXLAN) |

먼저 manager 노드에서 Swarm을 초기화한다. 여러 NIC가 있는 환경에서는 다른 노드가 도달할 수 있는 IP를 `--advertise-addr`에 명시하는 것이 안전하다.

```bash
docker swarm init --advertise-addr 192.168.0.101
```

초기화가 완료되면 worker가 실행할 `docker swarm join` 명령이 출력된다. 명령을 잃어버렸다면 manager에서 다음처럼 다시 확인할 수 있다.

```bash
# worker 참여 명령 조회
docker swarm join-token worker

# manager 참여 명령 조회
docker swarm join-token manager
```

출력된 worker 참여 명령을 각 worker 노드에서 실행한다. 토큰은 예시 값이 아니라 현재 클러스터에서 출력된 값을 사용해야 한다.

```bash
docker swarm join --token <WORKER_JOIN_TOKEN> 192.168.0.101:2377
```

manager에서 노드 상태를 확인한다. `docker node` 계열의 클러스터 관리 명령은 manager에서만 실행할 수 있다.

```bash
docker node ls
docker info
```

작업을 마친 worker는 해당 노드에서 다음 명령으로 Swarm을 떠날 수 있다.

```bash
docker swarm leave
```

manager를 제거할 때도 `docker swarm leave`를 사용한다. 단, 마지막 manager를 강제로 떠나게 하는 `docker swarm leave --force`는 클러스터를 사실상 해체하는 작업이므로, 테스트 환경을 정리할 때처럼 의도가 분명한 경우에만 사용해야 한다.

---

## 3. Service 생성과 원하는 상태 관리

Swarm에서는 독립 컨테이너 대신 service를 생성한다. 아래 서비스는 Alpine 컨테이너에서 3초마다 메시지를 출력한다.

```bash
docker service create \
  --name swarm-start \
  alpine:3 \
  /bin/sh -c "while true; do echo 'Docker Swarm Start'; sleep 3; done"
```

manager에서 서비스와 task 상태, 로그를 확인하고 필요하면 삭제할 수 있다.

```bash
docker service ls
docker service ps swarm-start
docker service logs -f swarm-start
docker service rm swarm-start
```

서비스를 생성할 때 `--replicas`로 원하는 task 수를 선언한다. 실제 컨테이너가 비정상 종료되거나 worker가 사용할 수 없게 되면, manager는 다른 활성 노드에 새 task를 배치해 선언한 개수를 맞추려고 한다. 이것이 **원하는 상태(desired state) 조정**이다.

```bash
docker service create \
  --name api \
  --replicas 3 \
  --constraint 'node.role == worker' \
  nginx:alpine
```

`--constraint 'node.role == worker'`는 manager에 task를 배치하지 않도록 제한한다. 반대로 `--mode global`을 사용하면 활성 노드마다 task를 하나씩 실행할 수 있어 모니터링·로그 수집 에이전트처럼 모든 노드에 필요한 작업에 적합하다.

```bash
docker service create --name node-agent --mode global alpine:3 sleep 1d
```

---

## 4. Overlay Network, DNS, Routing Mesh

Swarm 서비스끼리 통신하려면 일반적으로 Overlay Network를 사용한다. Overlay Network는 서로 다른 호스트의 컨테이너를 하나의 가상 네트워크로 연결하며, 서비스 이름을 DNS 이름처럼 사용할 수 있게 한다.

```bash
docker network create --driver overlay app-net

docker service create \
  --name backend \
  --network app-net \
  --replicas 2 \
  nginx:alpine
```

같은 `app-net`에 연결된 다른 서비스는 `backend`라는 이름으로 backend 서비스에 요청할 수 있다. 복제본 수나 각 task의 IP가 바뀌어도 애플리케이션은 IP 주소를 직접 관리할 필요가 없다. Swarm의 내장 DNS와 서비스 VIP가 요청을 실행 중인 task로 전달한다.

외부에 서비스를 공개할 때는 `--publish`를 사용한다. 기본 ingress 모드에서는 서비스를 실행하지 않는 노드까지 포함해 **모든 Swarm 노드**가 공개 포트를 받고, routing mesh가 요청을 실행 중인 task로 전달한다.

```bash
docker service create \
  --name web-alb \
  --replicas 2 \
  --publish published=8001,target=80 \
  --constraint 'node.role == worker' \
  nginx:alpine
```

위 예시에서 task가 worker에만 배치되더라도 `http://<manager-ip>:8001` 또는 다른 worker의 8001 포트로 요청할 수 있다. routing mesh가 실제 task가 있는 노드로 전달하고, 여러 task가 있으면 요청을 분산한다. 특정 노드에서 직접 포트를 열고 자체 로드 밸런서를 구성해야 하는 경우에는 `--publish mode=host`를 검토할 수 있지만, 이 경우 task의 배치 위치와 포트 충돌을 직접 관리해야 한다.

---

## 5. 확장, 장애 복구, 노드 유지 보수

실행 중인 서비스의 복제본 수는 중단 없이 변경할 수 있다.

```bash
docker service scale web-alb=3
docker service ps web-alb
```

노드 수보다 많은 복제본을 지정하면 한 노드에 여러 task가 배치될 수 있다. Swarm은 새 task를 배치할 때 가능한 한 작업이 적은 노드를 선택하지만, 이미 실행 중인 task를 단순히 균등화하려고 자동 재배치하지는 않는다. 재배치가 필요하면 서비스 업데이트를 통해 의도적으로 task를 다시 만들 수 있다.

유지 보수를 위해 특정 노드에 새 task가 배치되지 않게 하고, 실행 중인 Swarm task를 다른 활성 노드로 옮기려면 `drain`을 사용한다.

```bash
# manager에서 실행
docker node update --availability drain worker1

# 유지 보수가 끝난 뒤 다시 배치 대상으로 전환
docker node update --availability active worker1
```

`drain`은 Swarm service의 task에만 적용된다. `docker run`이나 `docker compose up`으로 독립 실행한 컨테이너는 자동으로 옮기거나 중지하지 않는다.

---

## 6. 롤링 업데이트와 롤백

서비스 이미지를 바꾸면 Swarm은 task를 순차적으로 교체하는 롤링 업데이트를 수행할 수 있다. 운영 환경에서는 한 번에 교체할 개수, 다음 그룹으로 넘어가기 전 대기 시간, 실패 시 동작을 명시적으로 설정하는 편이 좋다.

```bash
docker service update \
  --image nginx:1.27-alpine \
  --update-parallelism 1 \
  --update-delay 10s \
  --update-order start-first \
  --update-failure-action rollback \
  web-alb
```

| 옵션 | 역할 |
| --- | --- |
| `--update-parallelism` | 동시에 교체할 task 수. `0`이면 전체를 한 번에 교체 |
| `--update-delay` | 한 그룹의 교체가 끝난 후 다음 그룹까지 기다릴 시간 |
| `--update-order start-first` | 새 task를 먼저 시작한 뒤 기존 task를 중지. 일시적으로 더 많은 자원이 필요할 수 있음 |
| `--update-order stop-first` | 기존 task를 먼저 중지한 뒤 새 task를 시작. 자원은 적게 쓰지만 공백이 생길 수 있음 |
| `--update-failure-action` | `pause`, `continue`, `rollback` 중 업데이트 실패 시 동작 |

`start-first`라고 해서 새 컨테이너가 애플리케이션 수준에서 항상 준비되었다는 보장은 없다. 이미지에 적절한 `HEALTHCHECK`를 정의하고, 애플리케이션의 시작 시간에 맞는 모니터링·대기 설정을 함께 검토해야 한다.

문제가 있는 배포를 이전 서비스 명세로 되돌릴 때는 다음 명령을 사용한다.

```bash
docker service rollback web-alb
docker service ps web-alb
```

CPU·메모리 제한, 환경 변수, 포트 같은 설정도 `docker service update`로 갱신할 수 있다. 다만 환경 변수나 이미지 태그를 바꾸는 작업은 새 task 생성으로 이어질 수 있으므로, 복제본이 여러 개인 서비스에서 업데이트 정책과 함께 적용하는 것이 안전하다.

---

## 7. Compose 파일을 Stack으로 배포하기

서로 관련된 여러 서비스를 배포할 때는 Stack을 사용한다. Stack은 서비스, 네트워크, 볼륨 등 애플리케이션 리소스를 하나의 이름으로 묶는다. 아래 예시는 프론트엔드와 API를 같은 Overlay Network에 배포하는 간단한 `stack.yml`이다.

```yaml
services:
  frontend:
    image: nginx:alpine
    ports:
      - "8080:80"
    networks:
      - app-net
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.role == worker
      restart_policy:
        condition: on-failure

  api:
    image: example/api:1.0
    networks:
      - app-net
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.role == worker

networks:
  app-net:
    driver: overlay
```

manager에서 Stack을 배포하고 상태를 확인한다.

```bash
docker stack deploy --compose-file stack.yml myapp
docker stack services myapp
docker stack ps myapp
```

Stack 이름은 실제 서비스와 네트워크 이름 앞에 접두사로 붙는다. 예를 들어 `frontend` 서비스는 보통 `myapp_frontend`라는 이름으로 생성된다. 애플리케이션을 정리할 때는 Stack 단위로 제거한다.

```bash
docker stack rm myapp
```

`deploy` 영역은 Swarm Stack 배포를 위한 설정이다. 같은 파일을 `docker compose up`으로 실행할 때와 해석이 다를 수 있으므로, Swarm 배포에는 `docker stack deploy`를 사용하고 배포 후에는 `docker stack services`, `docker service ps`로 원하는 상태에 수렴했는지 확인한다.

---

## 8. Docker Swarm과 Kubernetes 선택하기

Docker Swarm은 Docker CLI와 Engine에 통합되어 있어 Docker를 이미 사용 중인 환경에서 비교적 짧은 학습 곡선으로 클러스터를 구성할 수 있다. 반면 Kubernetes는 더 넓은 생태계와 세밀한 확장 기능을 제공하며, 주요 클라우드의 관리형 Kubernetes 서비스와 통합하기 쉽다.

| 기준 | Docker Swarm | Kubernetes |
| --- | --- | --- |
| 시작 난이도 | Docker 개념을 알고 있으면 비교적 간단 | 구성 요소와 개념이 많아 학습 범위가 넓음 |
| 운영 기능 | 핵심적인 배포·확장·서비스 발견 기능 제공 | 자동 확장, 정책, 스토리지·로드 밸런서 연동 등 폭넓은 기능 |
| 클라우드 환경 | 클러스터를 직접 운영하는 설계에 적합 | 관리형 서비스와 생태계를 활용하기 좋음 |

서비스 규모와 운영 요구가 단순하고 Docker 중심의 학습·실습 환경이라면 Swarm이 좋은 출발점이 될 수 있다. 반대로 다양한 클라우드 통합, 고도화된 운영 자동화, 대규모 생태계가 필요하다면 Kubernetes를 검토하는 편이 적합하다.

---

## 9. 정리

Docker Swarm mode는 여러 Docker 호스트를 하나의 클러스터로 묶어 service 단위로 컨테이너를 운영하는 Docker Engine 내장 기능이다. manager는 원하는 상태를 기준으로 task를 배치·감시하고, 장애가 발생하면 사용할 수 있는 노드에 새 task를 만들어 복제본 수를 맞춘다.

Overlay Network와 내장 DNS는 여러 호스트에 분산된 서비스 간 통신을 단순하게 만들고, ingress routing mesh는 어느 노드로 들어온 공개 포트 요청도 실행 중인 task로 전달한다. 여기에 scale, drain, 롤링 업데이트, rollback, stack 배포를 조합하면 단일 Docker 호스트를 넘어선 기본적인 서비스 운영 흐름을 구성할 수 있다.
