---
layout: post
title: "Kubernetes (35) - Probe로 컨테이너 상태 점검하기"
date: 2026-09-04 16:43:33 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "health-check", "probe", "liveness", "readiness", "startup", "쿠버네티스"]
---

컨테이너 프로세스가 실행 중이라는 사실만으로 애플리케이션이 요청을 정상 처리한다는 보장은 없다. 교착 상태에 빠졌거나, 데이터베이스 연결을 기다리고 있거나, 초기 캐시를 아직 불러오는 중일 수 있다.

Kubernetes Probe는 kubelet이 컨테이너 상태를 주기적으로 확인하도록 하는 설정이다. 결과에 따라 컨테이너를 재시작하거나 Service 트래픽 대상에서 제외할 수 있으므로, 장애 복구와 안전한 배포 모두에 중요한 역할을 한다.

---

## 1. 세 Probe의 목적은 서로 다르다

Probe를 모두 같은 ‘헬스 체크’로 뭉뚱그리면 잘못된 설정을 만들기 쉽다. 실패했을 때의 결과를 기준으로 구분한다.

| Probe | 확인하는 질문 | 실패했을 때 |
| --- | --- | --- |
| Liveness Probe | 컨테이너가 복구 불가능한 상태에 빠졌는가? | kubelet이 해당 컨테이너를 재시작 |
| Readiness Probe | 지금 요청을 받을 준비가 되었는가? | Service의 Endpoint에서 제외, 컨테이너는 재시작하지 않음 |
| Startup Probe | 긴 초기화가 끝났는가? | 성공 전까지 Liveness·Readiness Probe를 실행하지 않음. 반복 실패 시 컨테이너 재시작 |

Liveness Probe는 프로세스는 살아 있지만 더 이상 진행하지 못하는 교착 상태나 복구 불가능한 오류를 감지하는 데 쓴다. 반면 Readiness Probe는 데이터베이스 연결, 캐시 로딩, 일시적 과부하처럼 **잠시 트래픽을 받으면 안 되는 상태**를 표현할 때 알맞다.

Startup Probe는 기동 시간이 긴 애플리케이션을 위한 보호 장치다. 이를 두면 초기화가 끝날 때까지 Liveness Probe가 성급하게 컨테이너를 재시작하는 문제를 줄일 수 있다.

---

## 2. 검사 방식은 애플리케이션에 맞춰 고른다

Probe는 컨테이너마다 설정한다. 일반적으로 HTTP 애플리케이션에는 `httpGet`, 포트만 확인하면 되는 서비스에는 `tcpSocket`, 내부 명령이나 파일 확인에는 `exec`를 사용한다.

| 방식 | 성공 조건 | 적합한 예 |
| --- | --- | --- |
| `httpGet` | HTTP 응답 코드가 200~399 | `/health`, `/ready` 엔드포인트 |
| `tcpSocket` | 지정 포트로 TCP 연결 가능 | HTTP가 아닌 TCP 서버, 포트 리스닝 확인 |
| `exec` | 컨테이너 안 명령의 종료 코드가 0 | 파일 존재, 내부 의존성 확인 |

`exec`는 애플리케이션의 실제 준비 상태를 표현하기 쉬운 반면, 검사 명령이 무겁거나 외부 의존성에 과도하게 묶이면 오탐이 생길 수 있다. 가능하다면 빠르고 부작용 없는 전용 헬스 엔드포인트를 만든다.

```yaml
# 방식별 Probe 예시
livenessProbe:
  httpGet:
    path: /health
    port: 8080

readinessProbe:
  tcpSocket:
    port: 8080

startupProbe:
  exec:
    command: ["test", "-e", "/app/initialized"]
```

---

## 3. 검사 간격과 실패 기준을 이해한다

세 Probe는 공통 설정을 사용한다. 값 하나를 크게 또는 작게 정하기보다, 애플리케이션의 정상 기동 시간과 일시적 지연 범위를 기준으로 조합해야 한다.

| 설정 | 의미 |
| --- | --- |
| `initialDelaySeconds` | 컨테이너 시작 후 첫 검사 전까지 기다리는 시간 |
| `periodSeconds` | 검사 주기 |
| `timeoutSeconds` | 한 번의 검사에 허용하는 최대 시간 |
| `successThreshold` | 연속 성공으로 정상으로 판단할 횟수 |
| `failureThreshold` | 연속 실패로 실패로 판단할 횟수 |

예를 들어 `periodSeconds: 5`, `failureThreshold: 3`이면 연속된 실패가 세 번 발생한 뒤 실패 처리한다. 일시적인 네트워크 지연에 즉시 반응하지 않도록 해 주지만, 장애 감지는 그만큼 늦어진다.

`successThreshold`는 Liveness Probe와 Startup Probe에서 반드시 `1`이어야 한다. 두 Probe는 한 번의 성공만으로 각각 컨테이너가 살아 있음과 기동 완료를 판단해 다음 단계로 넘어가는 것이 목적이므로, 여러 번의 성공을 기다릴 필요가 없다. 반면 Readiness Probe는 Service 트래픽을 다시 받기 시작하는 기준이므로, 일시적인 성공만으로 트래픽이 재개되지 않게 `successThreshold: 2` 이상을 설정할 수 있다.

시작 시간이 예측하기 어렵다면 Liveness Probe의 `initialDelaySeconds`만 길게 잡기보다 Startup Probe를 함께 두는 편이, 초기화 중 오탐과 실행 중 장애 감지 지연을 함께 줄이기 좋다.

---

## 4. Nginx에 Liveness와 Readiness Probe를 설정한다

다음 Pod는 `/index.html`을 Liveness Probe로, 별도의 정적 파일을 Readiness Probe로 확인한다. 실서비스에서는 정적 파일 대신 애플리케이션이 의존성 연결과 초기화를 확인하는 `/health`·`/ready` 같은 엔드포인트를 사용하는 편이 일반적이다.

```yaml
# sample-healthcheck.yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-healthcheck
spec:
  containers:
    - name: nginx
      image: nginx:1.27
      ports:
        - containerPort: 80
      livenessProbe:
        httpGet:
          path: /index.html
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 3
        timeoutSeconds: 1
        failureThreshold: 2
      readinessProbe:
        exec:
          command: ["test", "-e", "/usr/share/nginx/html/50x.html"]
        initialDelaySeconds: 5
        periodSeconds: 3
        timeoutSeconds: 1
        successThreshold: 2
        failureThreshold: 1
```

```bash
kubectl apply -f sample-healthcheck.yaml
kubectl get pod sample-healthcheck --watch
kubectl describe pod sample-healthcheck
```

`describe`의 Events에서 Probe 실패와 컨테이너 재시작 여부를 확인할 수 있다. Liveness 대상 파일을 지우면 실패 횟수가 기준에 도달한 뒤 **컨테이너가 재시작**된다. Pod 전체가 새 객체로 만들어지는 것과는 다르므로, `RESTARTS` 열과 Events를 함께 본다.

```bash
kubectl exec -it sample-healthcheck -- rm -f /usr/share/nginx/html/index.html
```

Readiness 대상 파일을 지우면 컨테이너는 계속 실행되지만 Pod는 Ready 상태가 아니게 된다. 이 Pod를 선택하는 Service가 있다면 Endpoint에서 빠져 새 요청을 받지 않는다.

```bash
kubectl exec -it sample-healthcheck -- rm -f /usr/share/nginx/html/50x.html
kubectl get pod sample-healthcheck
```

---

## 5. Startup Probe로 느린 기동을 보호한다

초기화가 오래 걸리는 서비스에 Liveness Probe만 설정하면, 준비되기 전에 실패로 판단되어 계속 재시작될 수 있다. 아래처럼 Startup Probe를 두면 성공할 때까지 다른 두 Probe가 시작되지 않는다.

```yaml
startupProbe:
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 5
  failureThreshold: 30

livenessProbe:
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
```

이 예시에서 Startup Probe는 최대 약 150초 동안 초기화를 기다린다. 단, 이는 ‘언제까지나 기다리는’ 설정이 아니다. 제한 시간 안에 계속 실패하면 컨테이너를 재시작하므로, 정상 기동 시간보다 충분한 값을 정해야 한다.

---

## 6. 정리

Liveness Probe는 복구 불가능한 컨테이너를 재시작하고, Readiness Probe는 준비되지 않은 Pod로 트래픽이 가지 않게 한다. Startup Probe는 긴 초기화 과정에서 Liveness Probe의 성급한 재시작을 막는다.

Probe는 단순히 포트가 열렸는지보다 애플리케이션이 실제로 요청을 처리할 준비가 되었는지를 표현해야 한다. 정상 기동 시간, 일시적인 장애, 의존 서비스의 상태를 고려해 간격과 실패 기준을 조정하고, 배포 전에는 `kubectl describe pod`의 Events로 의도한 대로 동작하는지 검증한다.

---

## 참고 자료

* [Kubernetes 문서 - Liveness, Readiness, Startup Probe 구성](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
* [Kubernetes 문서 - Pod Lifecycle의 Container Probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes)
