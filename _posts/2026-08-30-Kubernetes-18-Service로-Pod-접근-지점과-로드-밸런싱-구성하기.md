---
layout: post
title: "Kubernetes (18) - Service로 Pod 접근 지점과 로드 밸런싱 구성하기"
date: 2026-08-30 21:04:04 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "service", "clusterip", "nodeport", "loadbalancer", "externalname", "networking", "쿠버네티스"]
---

## 1. Service가 필요한 이유

Deployment가 관리하는 Pod는 교체·확장·축소 과정에서 IP 주소가 바뀔 수 있다. 클라이언트가 특정 Pod IP를 직접 사용하면 Pod가 재생성됐을 때 통신 대상이 사라지고, 여러 Pod에 트래픽을 나누기도 어렵다.

Service는 같은 기능을 제공하는 Pod 집합 앞에 **고정된 접근 지점**을 제공하는 Kubernetes 리소스다. 클라이언트는 Service의 이름 또는 가상 IP로 접속하고, Service는 selector와 일치하는 준비된 Pod 엔드포인트로 트래픽을 전달한다.

```text
클라이언트
    ↓ Service 이름 또는 IP
Service (고정된 접근 지점)
    ↓ selector: app=webui
Pod 1 / Pod 2 / Pod 3
```

Service는 Pod 개수가 늘거나 줄어도 selector와 일치하는 엔드포인트 목록을 갱신한다. 따라서 클라이언트는 Pod IP 변화와 무관하게 같은 Service 주소를 계속 사용할 수 있다.

---

## 2. 실전으로 보는 Service: 바뀌는 Pod IP를 고정 이름으로 감추기

한마디로 Service는 **Pod 앞에 고정된 주소를 붙이는 리소스**다. Deployment만으로는 Pod를 생성·교체·확장할 수 있지만, 다른 애플리케이션이 안정적으로 호출할 이름이나 주소를 제공하지는 않는다.

예를 들어 `ingress-lab` 네임스페이스에서 관찰한 Pod 상태가 다음과 같다고 하자. 이 값은 특정 시점의 예시이며, Pod가 재생성되면 이름과 IP가 달라질 수 있다.

| Pod | IP | 노드 |
| --- | --- | --- |
| `kafka-7fd968b8d8-tjmkm` | `10.244.169.182` | `k8s-node2` |
| `mysql-6fc65d59b4-42bxz` | `10.244.169.179` | `k8s-node2` |
| `mongodb-85547b8478-mq9lm` | `10.244.36.68` | `k8s-node1` |

Deployment가 새 ReplicaSet을 만들거나 Pod를 다른 노드에 재배치하면 Pod IP와 이름 뒤의 해시가 바뀐다. 따라서 애플리케이션 설정에는 Pod IP가 아닌 Service 이름을 넣어야 한다.

```yaml
env:
  - name: SPRING_KAFKA_BOOTSTRAP_SERVERS
    value: "kafka:9092"
  - name: SPRING_DATASOURCE_URL
    value: "jdbc:mysql://mysql:3306/itemdb"
```

여기서 `kafka`와 `mysql`은 같은 네임스페이스의 Service 이름이다. 예를 들어 `kafka` Service에 `10.103.196.4`라는 ClusterIP가 할당됐다면, 호출 경로는 다음과 같다.

```text
kafka:9092                 변하지 않는 Service DNS 이름
    ↓ DNS 조회
ClusterIP 10.103.196.4     Service가 유지되는 동안 유지되는 가상 IP
    ↓ Service 프록시 규칙
현재 Ready 상태의 Kafka Pod IP:9092
```

### Service가 맡는 네 가지 역할

1. **안정적인 이름(DNS)**

   `metadata.name: kafka`는 같은 네임스페이스에서 `kafka`로, 전체 이름으로는 `kafka.ingress-lab.svc.cluster.local`로 조회할 수 있다. CoreDNS는 일반 ClusterIP Service 이름을 ClusterIP로 응답하므로, 호출자는 Pod가 교체돼도 같은 이름을 계속 사용한다.

2. **고정된 가상 IP(ClusterIP)**

   ClusterIP는 특정 Pod의 NIC에 붙은 주소가 아니라 Service 프록시가 처리하는 가상 IP다. 노드의 kube-proxy 또는 CNI의 Service 프록시 구현체가 Service와 EndpointSlice 상태를 바탕으로 커널 전달 규칙을 구성하고, 이 IP의 요청을 실제 Pod IP와 `targetPort`로 보낸다. Service 리소스를 삭제하지 않는 한 ClusterIP는 유지된다.

3. **Pod 추적(selector → EndpointSlice)**

   Service는 Deployment 이름을 참조하지 않는다. `selector: app=kafka`처럼 Pod 레이블을 기준으로 백엔드를 찾고, 컨트롤 플레인이 일치하는 Pod를 EndpointSlice에 반영한다.

   ```text
   Service kafka
   selector: app=kafka
       ↓
   EndpointSlice: kafka-xxxxx
   endpoints: 10.244.169.182:9092
   ```

   Pod가 종료되거나 준비 상태가 아니면 일반적으로 트래픽 대상에서 제외되고, 새 Pod가 Ready 상태가 되면 새 IP가 엔드포인트에 추가된다. `readinessProbe`가 중요한 이유도 여기에 있다. 컨테이너가 실행 중이더라도 실제 요청을 처리할 준비가 되기 전에는 Service 트래픽을 받지 않도록 만들 수 있다.

4. **여러 Pod로의 분산**

   현재 `replicas: 1`이면 눈에 잘 보이지 않지만, Deployment를 3개로 확장하면 EndpointSlice에 여러 Pod IP가 등록된다. Service 이름과 호출 코드의 변경 없이 Service 프록시가 준비된 엔드포인트 중 하나로 연결을 분산한다.

### 각 Service가 가리키는 대상

| Service | 주 호출자 | 호출 또는 참조 위치 |
| --- | --- | --- |
| `mysql:3306` | `for-docker` 앱 | `jdbc:mysql://mysql:3306/itemdb` |
| `mongodb:27017` | `for-docker-query` 앱 | `mongodb://mongodb:27017/itemview` |
| `kafka:9092` | 두 애플리케이션과 Kafka 클라이언트 | `SPRING_KAFKA_BOOTSTRAP_SERVERS=kafka:9092` |
| `for-docker:80` | Ingress Controller | Ingress의 `backend.service.name` |
| `for-docker-query:80` | Ingress Controller | Ingress의 `backend.service.name` |

MySQL·MongoDB·Kafka Service는 클러스터 내부 통신의 고정 이름을 제공한다. `for-docker`, `for-docker-query` Service는 Ingress가 백엔드로 지정하는 안정적인 진입점이다. 일반적인 Ingress 규칙은 Pod를 직접 선택하지 않고 Service 이름과 포트를 참조한다.

Kafka처럼 브로커가 하나인 구성에서는 `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092`처럼 Service 이름을 광고 주소로 사용할 수 있다. 클라이언트는 부트스트랩 이후에도 이 이름으로 다시 접속하므로 Pod IP를 광고하지 않는 것이 중요하다. 다만 여러 Kafka 브로커를 운영할 때는 각 브로커에 개별적으로 도달할 주소가 필요하므로, 단일 ClusterIP Service 하나만으로 구성하지 말고 StatefulSet과 브로커별 Service 같은 Kafka 배포 방식에 맞는 네트워크 구성을 사용해야 한다.

### 직접 확인하기

Deployment를 재시작해 Pod IP가 바뀌어도 Service와 Ingress의 주소는 유지된다.

```bash
kubectl -n ingress-lab get pod -o wide | grep for-docker
kubectl -n ingress-lab rollout restart deployment/for-docker
kubectl -n ingress-lab get pod -o wide | grep for-docker

# Ingress와 DNS가 준비된 환경에서 확인
curl http://command.test.com/
```

새 Pod가 Ready 상태가 된 뒤에도 마지막 요청이 성공한다면, Service가 바뀐 Pod IP를 새 EndpointSlice 항목으로 교체해 호출자에게 투명하게 연결하고 있다는 뜻이다.

---

## 3. Service의 핵심 구성 요소

Service는 주로 `selector`와 `ports`로 어떤 Pod의 어느 포트로 보낼지 정한다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: clusterip-service
spec:
  type: ClusterIP
  selector:
    app: webui
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
```

`selector`의 `app: webui`는 Pod의 레이블과 정확히 일치해야 한다. 이 예제에서는 Deployment가 만든 `app=webui` Pod들이 Service의 백엔드가 된다. selector가 일치하지 않으면 Service는 만들 수 있어도 연결할 엔드포인트가 없어 요청을 전달하지 못한다.

| 필드 | 역할 | 예제 값 |
| --- | --- | --- |
| `type` | Service를 노출하는 방식 | `ClusterIP` |
| `selector` | 백엔드 Pod를 선택하는 레이블 조건 | `app: webui` |
| `port` | Service가 받는 포트 | `80` |
| `targetPort` | 선택된 Pod 컨테이너가 실제로 받는 포트 | `80` |
| `nodePort` | NodePort·LoadBalancer에서 노드에 여는 포트 | `30200` |

`port`와 `targetPort`는 같을 필요가 없다. 예를 들어 Service의 `port: 80` 요청을 애플리케이션 컨테이너의 `targetPort: 8080`으로 전달할 수 있다.

---

## 4. Service가 Pod를 찾고 트래픽을 전달하는 과정

Service를 생성하면 Kubernetes는 selector에 맞는 Pod를 찾아 EndpointSlice에 등록한다. 실습에서 `kubectl describe svc clusterip-service`를 실행했을 때 다음처럼 세 개의 NGINX Pod IP가 `Endpoints`에 표시됐다.

```text
Selector:   app=webui
Endpoints:  10.244.3.48:80,10.244.1.41:80,10.244.2.34:80
```

각 Pod의 `index.html`을 `webui #1`, `webui #2`, `webui #3`으로 바꾼 뒤 Service IP에 반복해서 `curl`을 실행하자 서로 다른 응답이 반환됐다. 이는 Service가 하나의 접근 지점 뒤에서 여러 엔드포인트로 연결을 분산한다는 것을 보여 준다.

```text
curl Service-IP → webui #2
curl Service-IP → webui #1
curl Service-IP → webui #3
```

다만 Service는 요청마다 반드시 순서대로 Pod를 하나씩 선택하는 라운드 로빈을 보장하지 않는다. 네트워크 프록시 방식과 연결 상태에 따라 같은 Pod 응답이 연속으로 나타날 수 있다.

Deployment를 3개에서 5개로 확장한 뒤 다시 `describe`하면 기존 엔드포인트 뒤에 `+ 2 more...`가 표시된다. 즉 Service의 주소는 유지하면서 백엔드 목록만 자동으로 갱신된다.

```bash
kubectl describe svc clusterip-service
kubectl scale deploy webui --replicas=5
kubectl describe svc clusterip-service
```

---

## 5. ClusterIP: 클러스터 내부의 기본 접근 방식

`ClusterIP`는 Service 타입을 생략했을 때 적용되는 기본값이다. Service 전용 CIDR에서 가상 IP를 할당하며, 일반적으로 클러스터 내부에서만 이 IP와 DNS 이름으로 접근한다.

```yaml
# clusterip-nginx.yaml
apiVersion: v1
kind: Service
metadata:
  name: clusterip-service
spec:
  type: ClusterIP
  # clusterIP: 10.100.100.100
  selector:
    app: webui
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
```

`clusterIP`를 생략하면 Kubernetes가 Service CIDR에서 사용 가능한 IP를 자동 할당한다. 실습에서는 `10.96.213.208`이 할당됐고, 이 주소로 `curl`해 NGINX 응답을 확인했다.

```bash
kubectl apply -f clusterip-nginx.yaml
kubectl get svc clusterip-service
kubectl describe svc clusterip-service
curl <cluster-ip>
```

특정 `clusterIP`를 직접 지정할 수도 있지만, 반드시 API 서버에 설정된 Service CIDR 범위 안의 미사용 주소여야 한다. 실습에서 `10.100.100.100`을 지정했을 때 현재 클러스터의 범위와 맞지 않아 다음 오류가 발생했다.

```text
failed to allocate IP 10.100.100.100: the provided network does not match the current range
```

따라서 별도의 고정 IP 요구 사항이 없다면 자동 할당을 사용하는 편이 안전하다. `10.96.0.0/12`처럼 보이는 범위는 kubeadm 등의 설치 설정에 따라 달라질 수 있으므로, 다른 클러스터의 예제 IP를 그대로 사용하면 안 된다.

클러스터 내부 Pod에서는 IP 대신 DNS 이름을 사용한다. 같은 네임스페이스라면 `clusterip-service`, 전체 이름이 필요하면 `clusterip-service.default.svc.cluster.local`처럼 접근할 수 있다.

---

## 6. NodePort: 노드 IP와 고정 포트로 노출하기

`NodePort`는 ClusterIP를 만들고, 모든 노드의 IP에 같은 포트를 열어 외부에서 접근할 수 있게 한다. 기본 포트 범위는 `30000-32767`이며, 실습의 `30200`은 그 범위에 포함된다.

```yaml
# nodeport-nginx.yaml
apiVersion: v1
kind: Service
metadata:
  name: nodeport-service
spec:
  type: NodePort
  # clusterIP: 10.100.100.200
  selector:
    app: webui
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
      nodePort: 30200
```

접속 주소는 **Pod IP가 아니라 노드 IP**다.

```text
http://<node-ip>:30200
```

실습에서 `curl 10.244.3.48:30200`이 실패한 것은 `10.244.3.48`이 Pod IP이기 때문이다. Pod의 NGINX 포트에는 `curl 10.244.3.48:80`으로 직접 연결할 수 있지만, `30200`은 Pod에 열린 포트가 아니라 NodePort를 위해 노드에 예약된 포트다.

```bash
kubectl apply -f nodeport-nginx.yaml
kubectl get svc nodeport-service

# 노드 IP로 접속
curl http://<node-ip>:30200
```

`<node-ip>:30200`으로 들어온 요청도 selector에 연결된 여러 Pod 엔드포인트 중 하나로 전달되므로, 결과적으로 **Service 수준의 L4 트래픽 분산**이 동작한다. 다만 `LoadBalancer` 타입처럼 클라우드나 별도 장비의 외부 로드 밸런서가 처리하는 것은 아니다. NodePort에서는 각 노드의 kube-proxy 또는 CNI가 노드 포트로 들어온 트래픽을 Service의 백엔드 Pod로 전달한다.

`nodePort`를 직접 지정하면 다른 Service와 포트가 충돌하지 않는지 관리해야 한다. 생략하면 Kubernetes가 설정된 NodePort 범위에서 자동 할당한다.

---

## 7. LoadBalancer: 외부 로드 밸런서 연동

`LoadBalancer`는 클라우드 제공자 또는 로드 밸런서 구현체에 외부 로드 밸런서 생성을 요청하는 Service 타입이다. 일반적으로 LoadBalancer Service는 NodePort를 바탕으로 외부 로드 밸런서의 트래픽을 백엔드 Pod로 전달한다.

```yaml
# loadbalancer-nginx.yaml
apiVersion: v1
kind: Service
metadata:
  name: loadbalancer-service
spec:
  type: LoadBalancer
  selector:
    app: webui
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
```

```bash
kubectl apply -f loadbalancer-nginx.yaml
kubectl get svc loadbalancer-service
```

실습 환경에서는 다음처럼 `EXTERNAL-IP`가 `<pending>`으로 표시됐다.

```text
NAME                   TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)
loadbalancer-service   LoadBalancer   10.96.173.134   <pending>     80:31889/TCP
```

이는 Kubernetes 자체에 외부 로드 밸런서 장비를 만드는 기능이 없고, 이를 수행할 클라우드 연동 또는 별도의 로드 밸런서 컨트롤러가 실습 클러스터에 없기 때문이다. 지원되는 클라우드 환경에서는 프로비저닝이 완료되면 `EXTERNAL-IP` 또는 호스트 이름이 할당된다.

LoadBalancer는 여러 서버로 요청을 나눠 보내는 **클러스터 바깥쪽의 실제 네트워크 장비 또는 클라우드 서비스**다. `type: LoadBalancer`는 Kubernetes가 이 인프라에 외부용 로드 밸런서를 만들어 달라고 요청하는 방식이며, YAML만으로 로드 밸런서 장비가 새로 구현되는 것은 아니다.

```text
사용자
    ↓ 공인 IP 또는 도메인
외부 Load Balancer
    ↓
Kubernetes NodePort
    ↓
Service의 백엔드 Pod들
```

일반적인 구현에서는 외부 Load Balancer가 노드의 NodePort로 트래픽을 전달하고, NodePort Service가 다시 준비된 Pod 엔드포인트 중 하나로 보낸다. 그래서 LoadBalancer Service를 만들면 실습 출력처럼 `80:31889/TCP`처럼 NodePort도 함께 할당되는 경우가 많다.

| 구분 | NodePort | LoadBalancer |
| --- | --- | --- |
| 외부 진입 주소 | `<node-ip>:<nodePort>` | 공인 IP 또는 외부 도메인 |
| 외부 로드 밸런서 장비 | 없음 | 클라우드 또는 별도 구현체가 제공 |
| 적합한 환경 | 실습·개발·자체 로드 밸런서 구성 | 클라우드 운영 환경 |

따라서 `EXTERNAL-IP: <pending>`은 Service 설정 오류가 아니라, 공인 IP와 외부 로드 밸런서를 프로비저닝할 인프라가 아직 없거나 준비 중이라는 의미다.

프로비저닝이 완료되면 `EXTERNAL-IP`에는 외부 Load Balancer에 할당된 **공인 IP**가 표시되는 것이 일반적이다. 제공자에 따라 숫자 IP 대신 외부 Load Balancer의 DNS 이름이 표시될 수도 있으며, 사용자는 이 주소로 접속한다.

```text
EXTERNAL-IP: 203.0.113.10      # 외부 Load Balancer의 공인 IP 예시
```

일반적인 NodePort 기반 구현에서는 외부 Load Balancer가 정상 상태인 노드 하나를 먼저 선택해 그 노드의 NodePort로 요청을 전달한다. 이후 Service 규칙이 준비된 Pod 중 하나를 다시 선택하므로, 요청을 받은 노드와 실제 응답 Pod가 있는 노드는 다를 수 있다.

```text
사용자 → Load Balancer 공인 IP → Node 1:NodePort → Pod 1·Pod 2·Pod 3 중 하나
```

클라우드 제공자와 설정에 따라서는 외부 Load Balancer가 NodePort를 거치지 않고 Pod IP를 직접 백엔드로 선택하는 구성도 가능하다. 어느 방식인지는 사용 중인 클라우드와 LoadBalancer 구현체의 설정에 따라 달라진다.

---

## 8. ExternalName: 외부 도메인의 DNS 별칭 만들기

`ExternalName`은 Pod를 선택하거나 프록시를 구성하지 않는다. 대신 클러스터 내부의 Service DNS 이름을 외부 도메인의 CNAME 별칭으로 응답하게 한다.

```yaml
# external-name.yaml
apiVersion: v1
kind: Service
metadata:
  name: externalname-svc
spec:
  type: ExternalName
  externalName: google.com
```

이 Service를 만들면 내부 클라이언트는 `externalname-svc.default.svc.cluster.local`로 요청할 수 있고, 클러스터 DNS가 이를 `google.com`으로 해석한다.

```bash
kubectl apply -f external-name.yaml
kubectl get svc externalname-svc

# 클러스터 내부에서 확인
kubectl run testpod -it --image=centos:7 -- /bin/bash
curl externalname-svc.default.svc.cluster.local
```

실습 출력에서 `EXTERNAL-IP` 열에 `google.com`이 보이고, 테스트 Pod의 `curl`이 Google의 응답을 받은 것은 DNS 별칭이 동작했음을 보여 준다. 다만 HTTP·HTTPS에서는 내부 Service 이름으로 보낸 `Host` 헤더나 TLS 인증서 이름이 외부 도메인과 달라 `404` 또는 인증서 오류가 생길 수 있다. 실습의 Google `404`도 이 점을 보여 주는 사례다.

---

## 9. Service 타입 비교와 운영 시 주의점

| 타입 | 접근 주소 | 외부 노출 | 주요 용도 |
| --- | --- | --- | --- |
| `ClusterIP` | Service DNS·Cluster IP | 기본적으로 불가 | 클러스터 내부 API·DB |
| `NodePort` | `<node-ip>:<nodePort>` | 가능 | 개발·테스트, 자체 로드 밸런서의 백엔드 |
| `LoadBalancer` | 외부 IP 또는 호스트 이름 | 가능 | 클라우드 환경의 외부 서비스 노출 |
| `ExternalName` | Service DNS → 외부 도메인 CNAME | 외부 도메인으로 연결 | 외부 API·DB 도메인을 내부 이름으로 추상화 |

Headless Service는 네 번째 타입에 더해지는 별도 타입이 아니다. `type: ClusterIP`에서 `clusterIP: None`을 설정하는 변형으로, 하나의 가상 IP로 로드 밸런싱하지 않고 Pod별 DNS 레코드를 제공한다. StatefulSet의 Pod별 DNS에서 이 방식을 사용한다.

Service 상태와 엔드포인트는 다음 명령으로 확인한다.

```bash
kubectl get svc
kubectl describe svc <service-name>
kubectl get endpointslice -l kubernetes.io/service-name=<service-name>
```

마지막으로 `kubectl delete svc --all`은 현재 네임스페이스의 Service를 전부 삭제한다. 실습 로그처럼 기본 `kubernetes` Service까지 대상이 될 수 있으므로, 운영 환경에서는 `kubectl delete svc <service-name>`처럼 삭제 대상을 명확히 지정해야 한다.

---

## 10. 정리

Service는 동적으로 바뀌는 Pod 집합 앞에 고정된 이름과 접근 지점을 제공하고, selector에 맞는 준비된 Pod 엔드포인트로 트래픽을 전달한다. `port`는 Service의 포트, `targetPort`는 컨테이너 포트이며, 레이블과 selector가 일치해야 한다.

내부 통신에는 기본값인 ClusterIP를 사용하고, 간단한 외부 노출은 NodePort, 클라우드 로드 밸런서 연동은 LoadBalancer를 선택한다. ExternalName은 트래픽을 프록시하지 않고 DNS CNAME만 만들므로 HTTP·TLS 호스트 이름 문제를 고려해야 한다. Pod IP가 아닌 Service DNS 이름을 기준으로 통신하도록 설계하면 확장과 교체에도 안정적인 네트워크 구성을 유지할 수 있다.

---

## 참고 자료

* [Service | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/services-networking/service/)
