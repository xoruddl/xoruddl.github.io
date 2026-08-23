---
layout: post
title: "Kubernetes (4) - livenessProbe로 컨테이너 상태 점검하기"
date: 2026-08-23 19:10:49 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "kubectl", "pod", "livenessprobe", "health-check", "쿠버네티스"]
---

컨테이너 프로세스가 실행 중이라는 사실만으로 애플리케이션이 정상 동작한다고 보기는 어렵다. 요청을 처리하지 못한 채 멈춰 있거나 내부 오류 상태에 빠질 수 있기 때문이다.

livenessProbe는 kubelet이 컨테이너의 생존 여부를 주기적으로 검사하도록 하는 설정이다. 검사에 연속으로 실패하면 kubelet은 컨테이너를 종료하고 Pod의 restartPolicy에 따라 다시 시작한다. 이번 글에서는 Nginx Pod에 HTTP livenessProbe를 적용하고, 실행 상태를 확인하는 과정을 정리한다.

---

## 1. livenessProbe란?

livenessProbe는 컨테이너가 계속 실행 가능한 상태인지 확인하는 헬스 체크다. Probe가 성공하면 컨테이너는 그대로 유지되고, 설정한 횟수만큼 연속 실패하면 컨테이너를 다시 시작한다.

Pod가 배치되었는지와 livenessProbe가 통과했는지는 별개의 상태다. Pod가 Node에 정상적으로 스케줄링됐더라도 애플리케이션이 응답하지 않으면 livenessProbe는 실패할 수 있다.

| 구분 | livenessProbe | readinessProbe |
| --- | --- | --- |
| 확인 대상 | 컨테이너를 재시작해야 하는지 | 트래픽을 받을 준비가 되었는지 |
| 실패 시 동작 | 컨테이너 재시작 | Service의 엔드포인트에서 제외 |
| 대표 상황 | 프로세스가 멈추거나 복구 불가 상태 | 초기화, 의존 서비스 연결 대기 |

느리게 시작하는 애플리케이션은 livenessProbe가 너무 빨리 실패하지 않도록 initialDelaySeconds를 설정하거나, 별도로 startupProbe를 사용해 시작 구간을 보호할 수 있다.

---

## 2. livenessProbe의 검사 방식

livenessProbe는 HTTP 요청, TCP 연결, 컨테이너 내부 명령 실행의 세 가지 방식으로 검사할 수 있다.

| 방식 | 설정 키 | 성공 조건 | 적합한 경우 |
| --- | --- | --- | --- |
| HTTP GET | httpGet | HTTP 상태 코드 200 이상 400 미만 | HTTP 헬스 엔드포인트가 있는 웹 애플리케이션 |
| TCP Socket | tcpSocket | 지정한 포트에 TCP 연결 성공 | 별도 HTTP 상태 엔드포인트가 없는 TCP 서비스 |
| Exec | exec | 컨테이너 내부 명령의 종료 코드가 0 | 파일·프로세스 등 내부 상태를 직접 확인할 때 |

HTTP 방식은 path와 port를 지정해 컨테이너에 요청을 보낸다.

~~~yaml
livenessProbe:
  httpGet:
    path: /
    port: 80
~~~

TCP 방식은 포트가 연결 가능한지만 확인한다.

~~~yaml
livenessProbe:
  tcpSocket:
    port: 22
~~~

Exec 방식은 명령의 종료 코드로 성공 여부를 판단한다.

~~~yaml
livenessProbe:
  exec:
    command:
      - ls
      - /data/file
~~~

위 설정의 command 배열은 여러 명령을 순서대로 실행하는 형태가 아니라, 실행 파일과 인수를 나눈 것이다. 따라서 컨테이너 내부에서는 `ls /data/file` 명령이 실행되며, 이 명령이 종료 코드 0으로 완료되면 Probe가 성공한다.

`/data/file`은 파일 또는 디렉터리로 존재하면 된다. 경로가 없거나 권한 문제로 `ls /data/file` 명령이 실패하면 종료 코드가 0이 아니므로 Probe도 실패한다. 예를 들어 경로가 없는 경우 `ls`는 일반적으로 종료 코드 2를 반환한다.

---

## 3. Nginx Pod에 HTTP livenessProbe 적용하기

기존 Nginx Pod 매니페스트를 복사해 livenessProbe 설정을 추가했다.

~~~bash
cp pod-nginx.yaml pod-nginx-liveness.yaml
kubectl delete pod --all
kubectl create -f pod-nginx-liveness.yaml
~~~

다음은 실습에 사용한 Pod 정의다.

~~~yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod-liveness
spec:
  containers:
    - name: nginx-container
      image: nginx:1.14
      ports:
        - containerPort: 80
          protocol: TCP
      livenessProbe:
        httpGet:
          path: /
          port: 80
        successThreshold: 1
        timeoutSeconds: 3
        periodSeconds: 30
        failureThreshold: 3
~~~

이 설정은 30초마다 Nginx의 80 포트 루트 경로에 HTTP GET 요청을 보낸다. 응답을 3초 동안 기다리고, 연속 세 번 실패하면 컨테이너를 재시작한다.

livenessProbe의 successThreshold는 1이어야 한다. 즉, 한 번의 검사만 성공해도 해당 검사 주기는 성공으로 처리되며, 2 이상으로 지정하면 유효하지 않은 Pod 설정이 된다. livenessProbe는 컨테이너를 재시작할지 판단하는 검사이므로, 성공 횟수를 누적해 별도의 상태 전환을 기다릴 필요가 없기 때문이다. 반면 readinessProbe는 Service 트래픽을 받을 준비가 되었는지 판단하므로, `successThreshold: 2`처럼 여러 번 연속 성공한 뒤 Ready 상태가 되도록 설정할 수 있다.

실습 명령의 `kubectl delete pod --all`은 현재 Namespace의 모든 Pod를 삭제하므로, 학습용 환경에서만 사용해야 한다. 운영 환경에서는 삭제할 Pod 이름과 Namespace를 명시하는 것이 안전하다.

---

## 4. 주요 매개 변수 이해하기

Probe의 검사 간격과 실패 기준은 다음 필드로 조절한다.

| 필드 | 의미 | 기본값 |
| --- | --- | --- |
| initialDelaySeconds | 컨테이너 시작 뒤 첫 검사까지 기다리는 시간(초) | 0 |
| periodSeconds | 검사를 반복하는 간격(초) | 10 |
| timeoutSeconds | 한 번의 검사 응답을 기다리는 시간(초) | 1 |
| successThreshold | 성공으로 판단하기 위해 필요한 연속 성공 횟수 | 1 |
| failureThreshold | 실패로 판단하기 위해 필요한 연속 실패 횟수 | 3 |

initialDelaySeconds를 생략하면 컨테이너가 시작된 직후부터 검사가 시작될 수 있다. 초기화에 시간이 필요한 서비스에서는 이 값과 failureThreshold를 서비스 특성에 맞게 조정해야 불필요한 재시작을 줄일 수 있다.

---

## 5. describe와 YAML로 설정 확인하기

Pod가 생성된 뒤에는 describe로 Probe 설정과 이벤트를 확인한다.

~~~bash
kubectl describe pod nginx-pod-liveness
~~~

실습에서는 다음과 같이 Liveness 항목이 출력됐다.

~~~text
Liveness:  http-get http://:80/ delay=0s timeout=3s period=30s #success=1 #failure=3
~~~

delay가 0초인 것은 initialDelaySeconds를 생략했기 때문이다. Pod 정의 전체를 YAML로 보면 Kubernetes API 서버에 저장된 livenessProbe 값을 확인할 수 있다.

~~~bash
kubectl get pod nginx-pod-liveness -o yaml
~~~

~~~yaml
livenessProbe:
  failureThreshold: 3
  httpGet:
    path: /
    port: 80
    scheme: HTTP
  periodSeconds: 30
  successThreshold: 1
  timeoutSeconds: 3
~~~

Probe가 실패해 컨테이너가 재시작되면 kubectl get pods의 RESTARTS 값이 증가한다. 원인을 파악할 때는 describe의 Events와 컨테이너 로그를 함께 확인한다.

~~~bash
kubectl get pods
kubectl describe pod nginx-pod-liveness
kubectl logs nginx-pod-liveness
~~~

---

## 6. 정리

livenessProbe는 컨테이너가 살아 있는지 주기적으로 검사하고, 연속 실패 시 컨테이너를 재시작하는 Kubernetes 기능이다. HTTP GET, TCP Socket, Exec 방식 중 애플리케이션이 실제로 정상 동작하는지를 가장 잘 보여주는 검사 방식을 선택해야 한다.

Nginx 실습에서는 80 포트의 루트 경로를 HTTP로 검사하고, 30초 간격·3초 타임아웃·세 번 연속 실패라는 기준을 적용했다. Probe 값은 너무 공격적으로 설정하면 정상적인 초기화나 일시적 지연에도 재시작을 일으킬 수 있으므로, 애플리케이션의 시작 시간과 응답 특성에 맞춰 조정하자.
