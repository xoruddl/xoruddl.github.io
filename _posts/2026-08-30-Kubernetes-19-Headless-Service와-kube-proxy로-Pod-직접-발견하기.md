---
layout: post
title: "Kubernetes (19) - Headless Service와 kube-proxy로 Pod 직접 발견하기"
date: 2026-08-30 22:30:10 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "service", "headless-service", "kube-proxy", "dns", "endpointslice", "iptables", "쿠버네티스"]
---

## 1. Headless Service가 필요한 이유

일반적인 ClusterIP Service는 하나의 가상 IP를 제공하고, 그 IP로 들어온 요청을 여러 Pod 엔드포인트에 분산한다. 하지만 StatefulSet처럼 각 Pod를 구분해 연결해야 하거나, 클라이언트가 백엔드 목록을 직접 발견하고 연결 대상을 선택해야 하는 경우에는 단일 가상 IP와 Service 수준의 로드 밸런싱이 오히려 맞지 않을 수 있다.

Headless Service는 `clusterIP: None`으로 만드는 Service다. ClusterIP를 할당하지 않고, Service DNS 조회 결과로 선택된 Pod 엔드포인트의 IP 주소를 직접 반환한다. 즉 Service라는 이름으로 Pod를 발견하되, 트래픽은 가상 IP·kube-proxy를 거치지 않고 선택한 Pod로 직접 간다.

```text
일반 ClusterIP Service
클라이언트 → Service 가상 IP → kube-proxy 규칙 → Pod 하나

Headless Service
클라이언트 → DNS 조회 → Pod IP 목록 → Pod 하나에 직접 연결
```

---

## 2. Headless Service 매니페스트

다음은 `app: webui` 레이블을 가진 Pod를 대상으로 하는 Headless Service다. YAML에서는 `metadata.name`과 각 계층의 들여쓰기가 정확해야 한다.

```yaml
# headless-nginx.yaml
apiVersion: v1
kind: Service
metadata:
  name: headless-service
spec:
  type: ClusterIP
  clusterIP: None
  selector:
    app: webui
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
```

`type: ClusterIP`는 생략해도 기본값으로 적용된다. 핵심은 `clusterIP: None`이다. 이 문자열은 IP 할당을 생략하라는 특별한 설정이며, `clusterIP` 필드를 단순히 비워 두는 것과는 다르다.

실습에서 Service를 생성한 뒤 확인한 결과는 다음과 같다.

```text
NAME               TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)
headless-service   ClusterIP   None         <none>        80/TCP
```

`TYPE`은 ClusterIP로 보이지만 `CLUSTER-IP`가 `None`이므로 Headless Service임을 알 수 있다.

---

## 3. DNS가 Pod 엔드포인트를 직접 반환하는 방식

Headless Service에 selector가 있으면 Kubernetes는 일치하는 준비된 Pod를 EndpointSlice에 등록한다. CoreDNS는 Service 이름을 조회했을 때 하나의 ClusterIP가 아니라 이 엔드포인트들의 A/AAAA 레코드를 반환한다.

실습의 상세 조회에서도 세 Pod가 Service 엔드포인트로 연결된 것을 확인할 수 있었다.

```text
Selector:   app=webui
IP:         None
Endpoints:  10.244.3.50:80,10.244.1.44:80,10.244.2.35:80
```

같은 네임스페이스의 Pod에서는 다음 이름으로 Service 엔드포인트 목록을 조회할 수 있다.

```text
headless-service
headless-service.default.svc.cluster.local
```

DNS 클라이언트는 반환된 여러 Pod IP 중 하나를 선택해 직접 연결한다. Headless Service 자체가 단일 VIP로 트래픽을 받아 Pod를 분산하는 것이 아니므로, 클라이언트 라이브러리의 DNS 처리 방식과 재시도 정책도 중요해진다.

### Headless Service 이름으로 할 수 있는 일

`headless-service.default.svc.cluster.local`은 특정 Pod 하나를 가리키는 이름이 아니라, 현재 Service에 연결된 Pod 엔드포인트 목록을 찾기 위한 DNS 이름이다. 클러스터 내부의 임시 Pod에서 다음처럼 확인할 수 있다.

```bash
kubectl run dns-test -it --rm --restart=Never --image=busybox:1.36 -- \
  nslookup headless-service.default.svc.cluster.local
```

조회 결과에는 다음처럼 여러 Pod IP가 표시될 수 있다.

```text
Name:      headless-service.default.svc.cluster.local
Address 1: 10.244.3.50
Address 2: 10.244.1.44
Address 3: 10.244.2.35
```

이 이름으로 요청하면 DNS 응답 중 하나의 Pod IP로 직접 연결한다.

```bash
kubectl run curl-test -it --rm --restart=Never --image=curlimages/curl -- \
  curl http://headless-service.default.svc.cluster.local
```

이 동작은 일반 Service의 kube-proxy 로드 밸런싱과 다르다. Headless Service의 DNS 응답에 여러 Pod IP가 포함되고, 운영체제나 애플리케이션 라이브러리가 그중 하나를 선택해 연결하는 **클라이언트 측 로드 밸런싱**에 가깝다. DNS 캐시와 사용하는 라이브러리의 IP 선택 방식에 따라 같은 Pod로 연속해서 요청이 갈 수도 있으므로, 매 요청마다 Pod가 순서대로 바뀌는 것을 보장하지는 않는다.

반대로 특정 Pod 하나를 골라 연결하는 용도는 아니다. `sf-nginx-0`처럼 고정된 특정 Pod에 연결해야 한다면 StatefulSet과 Headless Service를 조합해 제공되는 Pod별 DNS 이름을 사용한다.

```text
sf-nginx-0.sf-service.default.svc.cluster.local
sf-nginx-1.sf-service.default.svc.cluster.local
sf-nginx-2.sf-service.default.svc.cluster.local
```

### Pod IP 형식의 DNS 이름

실습에서는 테스트 Pod에서 다음 이름으로 특정 Pod에 접속했다.

```bash
curl 10-244-2-35.default.pod.cluster.local
```

이름의 `10-244-2-35`은 Pod IP `10.244.2.35`에서 점(`.`)을 하이픈(`-`)으로 바꾼 값이다. 조회가 성공하면 특정 Pod IP로 직접 연결된다.

```text
<pod-ip의 점을 하이픈으로 변환>.<namespace>.pod.<cluster-domain>
10-244-2-35.default.pod.cluster.local
```

이 Pod IP 형식 DNS 이름은 **Headless Service 이름과 다른 것**이다. 전자는 특정 IP의 Pod를 직접 가리키고, 후자는 selector에 연결된 여러 Pod 엔드포인트를 DNS로 발견하는 데 사용한다. 개별 Pod에 안정적인 이름이 반드시 필요하다면 Pod IP 형식보다는 StatefulSet과 Headless Service를 조합한 Pod별 DNS 이름을 사용하는 편이 적합하다.

---

## 4. ClusterIP Service와 Headless Service 비교

| 구분 | 일반 ClusterIP Service | Headless Service |
| --- | --- | --- |
| `clusterIP` | Service CIDR에서 가상 IP 할당 | `None` |
| DNS 조회 결과 | Service 가상 IP | 백엔드 Pod 엔드포인트 IP 목록 |
| 트래픽 경로 | VIP → kube-proxy/CNI 규칙 → Pod | 클라이언트 → 선택한 Pod IP |
| Service 수준 로드 밸런싱 | 제공 | 제공하지 않음 |
| 적합한 대상 | 일반적인 내부 API·웹 서비스 | StatefulSet, DB 클러스터, 클라이언트 측 로드 밸런싱 |

Headless Service가 Pod를 자동으로 고정 이름으로 바꾸는 것은 아니다. Deployment Pod처럼 이름과 IP가 바뀔 수 있는 워크로드에서는 DNS로 발견한 엔드포인트도 바뀔 수 있다. 고정된 Pod 이름·순번·DNS가 필요하다면 StatefulSet의 `serviceName`에 Headless Service를 연결해야 한다.

---

## 5. kube-proxy의 역할

`kube-proxy`는 각 노드에서 Service의 가상 IP와 NodePort 트래픽을 백엔드 엔드포인트로 전달하도록 네트워크 규칙을 관리하는 구성 요소다. 일반적인 클러스터에서는 각 노드에 하나씩 실행되며, 실습의 `kube-system` 네임스페이스에서도 노드별 `kube-proxy-*` Pod를 확인할 수 있었다.

```bash
kubectl get pods -n kube-system -l k8s-app=kube-proxy
```

kube-proxy는 요청을 매번 애플리케이션 프록시처럼 받아 전달하는 역할이 아니다. Service와 EndpointSlice 변화를 API 서버에서 감시하고, 현재 프록시 모드에 맞는 **노드 커널의 전달 규칙**을 동기화하는 역할이 핵심이다. 실제 패킷은 구성된 규칙을 따라 커널 수준에서 Pod로 전달된다.

```text
Service: clusterip-service (10.96.227.58:80)
EndpointSlice: 10.244.3.50:80, 10.244.1.44:80, 10.244.2.35:80
    ↓ kube-proxy가 노드 규칙을 동기화
클라이언트 → 10.96.227.58:80 → 선택된 Pod IP:80
```

| Service 타입 | kube-proxy가 관리하는 전달 경로 |
| --- | --- |
| ClusterIP | Service 가상 IP 요청을 준비된 Pod 중 하나로 전달 |
| NodePort | 노드 IP와 NodePort 요청을 해당 Service의 Pod로 전달 |
| LoadBalancer | 일반적인 NodePort 기반 구현에서는 외부 Load Balancer가 보낸 요청을 Pod로 전달하는 뒷단 경로 |
| Headless | 가상 IP가 없으므로 일반적인 Service 프록시 경로를 만들지 않음 |

따라서 kube-proxy는 “Service 주소와 실제 Pod를 이어 주는 노드별 네트워크 규칙 관리자”라고 이해하면 된다.

사용자가 ClusterIP 또는 NodePort의 가상 주소로 요청을 보내면, 이 규칙이 적용돼 준비된 Pod 중 하나로 전달된다. kube-proxy가 각 요청을 사용자 공간에서 직접 받아 중계하는 것은 아니며, Service와 EndpointSlice 변화를 보고 미리 구성해 둔 `iptables`·`nftables` 등의 커널 규칙이 실제 패킷을 처리한다.

```text
클라이언트
    ↓ ClusterIP:80 또는 Node IP:NodePort
노드의 전달 규칙 (kube-proxy가 Service·EndpointSlice 상태로 미리 동기화)
    ↓
선택된 Pod IP:targetPort
```

Pod가 추가·삭제되면 kube-proxy가 엔드포인트 변경을 감지해 이 규칙을 갱신한다. 그래서 클라이언트는 같은 ClusterIP 또는 NodePort 주소를 계속 사용하면서도 현재 준비된 Pod 집합으로 연결할 수 있다.

NodePort도 같은 원리다. kube-proxy는 노드의 NodePort로 들어온 트래픽이 해당 Service 엔드포인트로 전달되도록 규칙을 구성한다. 그래서 `<node-ip>:30200`으로 접속하면 Pod IP가 아닌 노드 포트에서 Service의 백엔드 Pod로 이어진다.

### Headless Service에서는 왜 kube-proxy를 거치지 않을까?

Headless Service에는 ClusterIP가 없으므로 kube-proxy가 가상 IP를 가로채고 변환할 대상도 없다. CoreDNS가 Pod 엔드포인트 IP를 직접 반환하고, 클라이언트가 그 IP로 연결한다.

```text
일반 Service: DNS → ClusterIP → kube-proxy → Pod
Headless:      DNS → Pod IP → Pod
```

따라서 Headless Service에서도 EndpointSlice와 DNS는 중요하지만, Service 가상 IP를 위한 kube-proxy의 로드 밸런싱 경로는 사용하지 않는다.

---

## 6. kube-proxy 프록시 모드

Linux 노드의 kube-proxy는 설정에 따라 여러 백엔드를 사용해 패킷 전달 규칙을 구성한다. 어떤 모드가 실제로 적용되는지는 클러스터의 kube-proxy 설정을 확인해야 한다.

| 모드 | 동작 방식 | 현재 관점 |
| --- | --- | --- |
| `iptables` | Linux 커널의 netfilter/iptables 규칙으로 Service·NodePort 트래픽을 Pod로 DNAT한다. 기본적으로 엔드포인트를 무작위로 선택한다. | 널리 사용되는 Linux 모드 |
| `nftables` | nftables 규칙으로 전달한다. iptables보다 엔드포인트 변경 처리와 대규모 규칙 처리 효율을 개선한다. | 최신 Linux 환경에서 고려할 모드 |
| `ipvs` | Linux 커널의 IPVS와 iptables 규칙을 사용하며, 여러 L4 스케줄링 알고리즘을 제공한다. | 최신 Kubernetes에서는 사용 중단(deprecated) 방향 |
| userspace | 초기 Kubernetes에서 kube-proxy 프로세스가 연결을 직접 프록시하던 방식이다. | 현대 Linux kube-proxy의 일반적인 선택지가 아님 |

`rr`(round-robin), `lc`(least-connection), `sh`(source hashing) 같은 알고리즘은 IPVS에서 선택할 수 있던 스케줄러의 예다. 하지만 새 환경에서는 IPVS보다 `iptables` 또는 `nftables`를 기준으로 설정을 검토하는 편이 안전하다.

현재 모드는 kube-proxy ConfigMap 또는 실행 인자에서 확인할 수 있다.

```bash
kubectl -n kube-system get configmap kube-proxy -o yaml
kubectl -n kube-system get daemonset kube-proxy -o yaml
```

---

## 7. 생성과 확인 명령

Headless Service를 적용하고 Service·엔드포인트·DNS를 차례로 확인한다.

```bash
kubectl apply -f headless-nginx.yaml
kubectl get svc headless-service
kubectl describe svc headless-service
kubectl get endpointslice -l kubernetes.io/service-name=headless-service
```

클러스터 내부에서 DNS 응답을 확인하려면 임시 Pod를 실행한다.

```bash
kubectl run testpod -it --rm --image=busybox:1.36 --restart=Never -- nslookup headless-service

# 특정 Pod IP 형식 DNS 이름 확인
kubectl run testpod -it --rm --image=busybox:1.36 --restart=Never -- \
  nslookup 10-244-2-35.default.pod.cluster.local
```

첫 번째 조회에서는 Headless Service에 연결된 준비 상태 Pod의 IP 목록을, 두 번째 조회에서는 지정한 Pod IP에 해당하는 DNS 레코드를 확인할 수 있다. 실제 결과는 Pod 재생성·확장에 따라 달라지므로 실습에 사용한 IP를 고정 값처럼 사용하면 안 된다.

---

## 8. 정리

Headless Service는 `clusterIP: None`으로 가상 IP와 Service 수준의 로드 밸런싱을 생략하고, DNS를 통해 Pod 엔드포인트를 직접 발견하게 한다. 단일 진입점보다 각 Pod를 구분해 연결해야 하는 StatefulSet·분산 데이터베이스·클라이언트 측 로드 밸런싱에 적합하다.

kube-proxy는 일반 ClusterIP·NodePort Service가 가상 IP와 노드 포트로 받은 요청을 엔드포인트 Pod로 전달하도록 노드의 커널 규칙을 관리한다. Headless Service는 이 프록시 경로 대신 DNS가 반환한 Pod IP로 직접 접속한다는 차이가 핵심이다.

---

## 참고 자료

* [Service | Kubernetes 공식 문서](https://kubernetes.io/docs/concepts/services-networking/service/)
* [Virtual IPs and Service Proxies | Kubernetes 공식 문서](https://kubernetes.io/docs/reference/networking/virtual-ips/)
