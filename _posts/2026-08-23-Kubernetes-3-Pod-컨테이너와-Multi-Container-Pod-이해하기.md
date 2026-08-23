---
layout: post
title: "Kubernetes (3) - Pod 컨테이너와 Multi-Container Pod 이해하기"
date: 2026-08-23 16:09:45 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "kubectl", "pod", "container", "multi-container", "쿠버네티스"]
---

Pod는 Kubernetes에서 컨테이너를 실행하는 가장 작은 배포 단위다. 간단한 웹 서버는 컨테이너 하나를 담은 Pod로 실행할 수 있고, 긴밀히 협력하는 컨테이너가 있다면 하나의 Pod에 함께 배치할 수도 있다.

이번 글에서는 Nginx 단일 컨테이너 Pod를 명령어와 YAML로 생성하고, Nginx와 CentOS 컨테이너를 함께 실행하는 Multi-Container Pod를 살펴본다. 특히 같은 Pod의 컨테이너가 localhost를 통해 통신하는 흐름을 실습으로 확인한다.

![Kubernetes에서 Pod와 컨테이너의 위치](/assets/img/posts/2026-08-23-Kubernetes-3-Pod-컨테이너와-Multi-Container-Pod-이해하기/kubernetes-pod-relationship.png)

위 그림처럼 Pod는 Worker Node에서 실행되며 하나 이상의 컨테이너를 담는다. 이 글에서는 그림의 Pod 내부 구조에 집중한다.

---

## 1. Pod와 컨테이너의 관계

컨테이너는 애플리케이션과 실행 환경을 패키징한 단위이고, Pod는 Kubernetes가 컨테이너를 배치하고 관리하는 단위다. 하나의 Pod에는 하나 이상의 컨테이너를 둘 수 있다.

Pod에 속한 컨테이너는 같은 네트워크 네임스페이스를 공유한다. 따라서 Pod에는 하나의 IP가 할당되며, 같은 Pod 안의 다른 컨테이너가 열어 둔 포트에는 localhost로 접근할 수 있다.

| 구분 | 단일 컨테이너 Pod | Multi-Container Pod |
| --- | --- | --- |
| 컨테이너 수 | 1개 | 2개 이상 |
| Pod IP | 컨테이너가 Pod IP를 사용 | 모든 컨테이너가 하나의 Pod IP 공유 |
| 컨테이너 간 통신 | 해당 없음 | localhost 포트로 통신 가능 |
| 대표 사례 | 독립적인 웹 애플리케이션 | 앱과 로그 수집·프록시 같은 보조 컨테이너 |

다만 컨테이너를 무조건 하나의 Pod에 모으는 것은 적절하지 않다. 서로 독립적으로 배포·확장해야 하는 애플리케이션은 보통 별도 Pod로 분리하고, 네트워크와 생명주기를 함께해야 하는 보조 역할에 Multi-Container Pod를 사용한다.

---

## 2. 명령어로 단일 컨테이너 Pod 만들기

kubectl run은 이미지를 지정해 간단한 Pod를 빠르게 생성할 때 사용할 수 있다.

~~~bash
kubectl run web1 --image=nginx:1.14 --port=80
kubectl get pods
~~~

실습에서는 web1 Pod가 생성된 뒤 다음처럼 실행 상태를 확인했다.

~~~text
NAME   READY   STATUS    RESTARTS   AGE
web1   1/1     Running   0          4s
~~~

READY 열의 1/1은 Pod에 선언된 컨테이너 한 개가 준비되었다는 뜻이다. Multi-Container Pod라면 준비된 컨테이너 수가 분자에 표시된다.

~~~bash
# Pod IP와 배치 노드까지 조회
kubectl get pods -o wide

# Pod의 상세 상태와 이벤트 확인
kubectl describe pod web1
~~~

describe 출력에서는 Pod IP, 컨테이너 이미지, 포트, 실행 상태와 Events를 확인할 수 있다. 이미지 다운로드나 스케줄링 문제를 진단할 때도 가장 먼저 확인할 만한 명령이다.

---

## 3. YAML로 Pod 선언하기

Pod는 YAML 매니페스트로 선언하면 설정을 검토하고 재현하기 쉽다. 다음은 Nginx 컨테이너 하나를 포함하는 Pod 예시다.

~~~yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
spec:
  containers:
    - name: nginx-container
      image: nginx:1.14
      ports:
        - containerPort: 80
          protocol: TCP
~~~

~~~bash
kubectl create -f pod-nginx.yaml
kubectl get pods -o wide
~~~

containers는 배열이므로 컨테이너를 한 개만 실행해도 -로 항목을 선언한다. containerPort는 컨테이너가 사용하는 포트를 문서화하고 도구가 인식하도록 하는 설정이며, 이 항목만으로 외부에 포트를 공개하지는 않는다. 외부 또는 다른 Pod에서 안정적으로 접근하려면 Service를 별도로 생성해야 한다.

---

## 4. Pod의 YAML·JSON과 IP 확인하기

kubectl run으로 만든 Pod도 API 서버에는 YAML 형태의 리소스 정의로 저장된다. 출력 형식을 바꾸면 Kubernetes가 기본값으로 채운 설정과 실제 상태를 함께 확인할 수 있다.

~~~bash
kubectl get pod web1 -o yaml
kubectl get pod web1 -o json

# JSON 출력에서 Pod IP만 빠르게 찾기
kubectl get pod web1 -o json | grep -i podip
~~~

출력에서 spec.containers에는 선언한 이미지와 포트가, status.podIP에는 실행 중인 Pod IP가 표시된다. kubectl get pods -o wide에서도 IP와 배치 노드를 간단히 확인할 수 있다.

~~~bash
kubectl get pods -o wide
curl <POD_IP>
~~~

Pod IP로 Nginx에 요청하면 기본 페이지가 응답한다. 단, Pod IP는 Pod가 재생성되면 달라질 수 있으므로 서비스의 고정된 접속 주소로 사용해서는 안 된다.

---

## 5. Redis Pod의 이미지 다운로드 오류 진단하기

명령어로 만든 리소스의 YAML 초안은 dry-run으로 확인할 수 있다. dry-run만 사용하는 형식은 더 이상 권장되지 않으므로, client 모드를 명시한다.

~~~bash
kubectl run redis +  --image=redis123 +  --dry-run=client +  -o yaml > redis.yaml
~~~

생성한 YAML을 적용한 뒤 상태를 확인한다.

~~~bash
kubectl create -f redis.yaml
kubectl get pods
~~~

실습에서는 존재하지 않는 redis123 이미지를 지정해 Pod가 ErrImagePull 상태가 됐다.

~~~text
NAME    READY   STATUS         RESTARTS   AGE
redis   0/1     ErrImagePull   0          11s
~~~

이미지나 컨테이너가 실행되지 않을 때는 describe의 Events 영역을 확인한다.

~~~bash
kubectl describe pod redis
~~~

Events에는 컨테이너 런타임이 docker.io/library/redis123:latest 이미지를 가져오려 했지만, 저장소가 없거나 권한이 없어 실패했다는 메시지가 나타난다. ErrImagePull은 한 번의 이미지 다운로드 실패 상태이고, 재시도 사이에 대기 시간이 적용되면 ImagePullBackOff로 표시된다.

| 상태 | 의미 | 우선 확인할 항목 |
| --- | --- | --- |
| ErrImagePull | 컨테이너 이미지를 내려받지 못함 | 이미지 이름·태그, 레지스트리 주소, 인증 정보 |
| ImagePullBackOff | 이미지 다운로드를 재시도하는 동안 대기 중 | describe의 Events에 나온 실제 오류 |

실습에서는 Pod 편집 명령으로 image 값을 올바른 Redis 이미지로 변경해 해결했다.

~~~bash
kubectl edit pod redis
~~~

편집기에서 containers 항목의 image를 redis로 수정하고 저장하면, kubelet이 변경된 이미지로 컨테이너를 다시 생성한다. 수정 뒤 다음처럼 실행 상태가 되면 해결된 것이다.

~~~text
NAME    READY   STATUS    RESTARTS   AGE
redis   1/1     Running   0          4m47s
~~~

실제 운영 환경에서는 실행 중인 Pod를 직접 편집하기보다, redis.yaml의 image 값을 수정한 뒤 선언 파일을 다시 적용하는 편이 변경 이력을 관리하기 쉽다. Deployment가 관리하는 Pod라면 Deployment의 Pod 템플릿을 수정해야 한다.

---

## 6. Multi-Container Pod 만들기

다음 매니페스트는 Nginx 웹 서버와 CentOS 컨테이너를 하나의 multipod에 넣는다. CentOS 컨테이너는 3초마다 localhost:80으로 요청을 보내도록 실행한다.

~~~yaml
apiVersion: v1
kind: Pod
metadata:
  name: multipod
spec:
  containers:
    - name: nginx-container
      image: nginx:1.14
      ports:
        - containerPort: 80
    - name: centos-container
      image: centos:7
      command:
        - /bin/sh
        - -c
        - while :; do curl http://localhost:80/; sleep 3; done
~~~

~~~bash
kubectl create -f pod-multi.yaml
kubectl get pods -o wide
~~~

실습 결과 multipod는 하나의 IP를 받고, 두 컨테이너가 모두 준비되어 2/2로 표시됐다.

~~~text
NAME       READY   STATUS    RESTARTS   AGE   IP
multipod   2/2     Running   0          16s   10.244.2.8
~~~

CentOS 컨테이너의 localhost:80 요청은 같은 Pod 안의 Nginx 컨테이너 포트 80으로 전달된다. 즉, 두 컨테이너는 같은 Pod IP와 네트워크를 공유하지만 각 컨테이너의 파일 시스템은 기본적으로 분리된다. 파일을 공유해야 한다면 emptyDir 같은 볼륨을 선언하고 두 컨테이너에 마운트해야 한다.

---

## 7. 컨테이너별 접속과 로그 확인하기

컨테이너가 여러 개인 Pod에서는 kubectl exec와 kubectl logs에 -c 옵션으로 대상을 지정하는 습관이 중요하다.

~~~bash
# Nginx 컨테이너의 셸 실행
kubectl exec multipod -it -c nginx-container -- /bin/bash

# CentOS 컨테이너의 셸 실행
kubectl exec multipod -it -c centos-container -- /bin/bash
~~~

CentOS 컨테이너에 접속해 다음 명령을 실행하면 Nginx가 제공하는 응답을 확인할 수 있다.

~~~bash
curl http://localhost:80
~~~

Nginx 컨테이너의 로그에는 CentOS 컨테이너가 보낸 요청이 남는다.

~~~bash
kubectl logs multipod -c nginx-container
~~~

~~~text
127.0.0.1 - - [23/Aug/2026:06:54:54 +0000] "GET / HTTP/1.1" 200 612 "-" "curl/7.29.0" "-"
~~~

로그의 127.0.0.1은 같은 Pod 안의 CentOS 컨테이너가 loopback 주소로 요청했다는 것을 보여준다. 컨테이너 이름을 생략하면 기본 컨테이너가 선택되거나 여러 컨테이너 중 하나를 지정하라는 오류가 날 수 있으므로, Multi-Container Pod에서는 -c를 명시하는 편이 분명하다.

---

## 8. 정리

Pod는 Kubernetes가 컨테이너를 실행하는 최소 단위이며, 하나 또는 여러 개의 컨테이너를 담을 수 있다. 단일 컨테이너 Pod는 kubectl run 또는 YAML 파일로 쉽게 만들 수 있고, get -o wide, describe, YAML·JSON 출력으로 실행 상태와 IP를 확인할 수 있다.

컨테이너가 Running 상태가 되지 않으면 kubectl describe pod의 Events부터 확인하자. ErrImagePull과 ImagePullBackOff는 이미지 이름, 태그, 레지스트리 접근 권한처럼 이미지 다운로드 단계의 문제를 뜻한다. 이번 Redis 실습처럼 원인을 확인한 뒤 YAML의 image를 올바르게 수정해 다시 적용하면 된다.

Multi-Container Pod의 컨테이너는 같은 네트워크를 공유하므로 localhost로 서로 통신할 수 있다. 이번 실습에서는 CentOS 컨테이너가 Nginx 컨테이너의 80 포트에 요청을 보내고, kubectl logs -c로 해당 요청 로그를 확인했다. 여러 컨테이너를 함께 둘 때는 정말 같은 배포·네트워크 단위여야 하는지 먼저 판단하고, 컨테이너별 진단 명령에는 -c 옵션을 사용한다.
