---
layout: post
title: "Kubernetes (20) - MetalLB로 온프레미스 LoadBalancer Service 구성하기"
date: 2026-09-01 07:53:21 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "service", "loadbalancer", "metallb", "bare-metal", "networking", "쿠버네티스"]
---

## 1. MetalLB가 필요한 이유

`type: LoadBalancer` Service는 외부 로드 밸런서 구현체에 공인 또는 외부 IP 할당을 요청한다고 정리했다. AWS·GCP 같은 클라우드에서는 해당 구현체가 제공되지만, kubeadm으로 구성한 온프레미스·가상 머신 클러스터에는 기본 구현체가 없는 경우가 많다. 이때 Service의 `EXTERNAL-IP`가 계속 `<pending>`으로 남는다.

MetalLB는 베어메탈 Kubernetes 클러스터에서 이 빈자리를 채우는 로드 밸런서 구현체다. 미리 확보한 네트워크 IP 대역에서 `LoadBalancer` Service에 주소를 할당하고, 그 주소로 향하는 트래픽이 클러스터에 도달하도록 네트워크에 알린다.

```text
클라이언트 → 외부 IP → MetalLB가 광고한 노드 → Service → Pod
```

MetalLB가 공인 IP나 라우터를 새로 만들어 주는 것은 아니다. 운영자는 기존 네트워크에서 다른 장비와 충돌하지 않는 주소 대역과, 그 대역을 광고할 수 있는 네트워크 환경을 먼저 마련해야 한다.

---

## 2. 구성 요소와 광고 방식

MetalLB를 설치하면 `metallb-system` 네임스페이스에 두 핵심 구성 요소가 배포된다.

| 구성 요소 | 배포 방식 | 역할 |
| --- | --- | --- |
| controller | Deployment | `LoadBalancer` Service에 IP를 할당하고 상태를 관리 |
| speaker | DaemonSet | 선택된 프로토콜로 Service IP 도달 경로를 네트워크에 광고 |

Service IP를 알리는 대표 방식은 다음과 같다.

| 방식 | 동작 | 적합한 환경 |
| --- | --- | --- |
| L2 | 한 노드가 ARP(IPv4) 또는 NDP(IPv6) 요청에 응답해 해당 IP의 MAC 주소를 알림 | 같은 L2 네트워크의 실습·소규모 환경 |
| BGP | 외부 라우터와 경로 정보를 교환 | BGP 라우터가 있는 운영 환경 |

L2 모드에서는 특정 시점에 한 노드가 Service IP의 트래픽을 받는다. 이후 Service 규칙이 백엔드 Pod로 요청을 분산한다. BGP 모드는 네트워크 라우터와 피어링 설정이 필요하므로, 단순한 로컬 클러스터에서는 L2 모드부터 확인하는 편이 이해하기 쉽다.

---

## 3. 설치 전 확인할 사항

가장 중요한 조건은 **IP 주소 충돌이 없는 것**이다. `IPAddressPool`에 지정할 주소는 DHCP 범위, 노드 IP, 게이트웨이, 다른 장비가 사용 중인 주소와 겹치면 안 된다. 예제의 `192.168.56.20-192.168.56.30`은 VirtualBox 등의 사설 실습망에서만 가능한 예시일 뿐, 그대로 운영망에 적용하면 안 된다.

IPVS 모드의 kube-proxy를 사용한다면 MetalLB 공식 문서에 따라 strict ARP 설정도 확인한다. 반대로 사용 중인 CNI와 클라우드 환경이 MetalLB의 네트워크 광고 방식과 호환되는지도 사전에 검토해야 한다. 대부분의 퍼블릭 클라우드 환경은 자체 LoadBalancer 통합을 우선 사용한다.

---

## 4. MetalLB 설치와 IP 풀 설정

아래는 native 모드 매니페스트로 설치하는 예다. MetalLB 릴리스는 바뀔 수 있으므로 운영 환경에서는 설치 전에 [공식 릴리스와 호환성](https://metallb.io/installation/)을 확인하고 검증한 버전을 고정한다.

```bash
kubectl apply -f \
  https://raw.githubusercontent.com/metallb/metallb/v0.16.1/config/manifests/metallb-native.yaml

kubectl get all -n metallb-system
```

설치만으로는 IP가 할당되지 않는다. `IPAddressPool`로 MetalLB가 사용할 주소를 선언하고, L2 모드에서는 `L2Advertisement`로 그 풀을 광고한다.

```yaml
# metallb-l2.yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: local-lb-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.56.20-192.168.56.30
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: local-lb-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - local-lb-pool
```

```bash
kubectl apply -f metallb-l2.yaml
kubectl get ipaddresspools,l2advertisements -n metallb-system
```

`L2Advertisement`에서 `ipAddressPools`를 생략하면 모든 IP 풀에 적용된다. 여러 목적의 풀을 운영한다면 명시적으로 연결해 의도하지 않은 주소가 L2로 광고되지 않게 하는 편이 안전하다.

---

## 5. LoadBalancer Service로 확인하기

이제 일반적인 `LoadBalancer` Service를 만든다. Service의 selector는 이미 배포된 `app: sample-app` Pod와 일치해야 한다.

```yaml
# sample-lb.yaml
apiVersion: v1
kind: Service
metadata:
  name: sample-lb
spec:
  type: LoadBalancer
  selector:
    app: sample-app
  ports:
    - name: http
      protocol: TCP
      port: 8080
      targetPort: 80
```

```bash
kubectl apply -f sample-lb.yaml
kubectl get svc sample-lb
kubectl describe svc sample-lb
```

정상적으로 주소가 할당되면 `EXTERNAL-IP`에 IP 풀의 주소 하나가 표시된다. 예를 들어 `192.168.56.20`이 보인다면 다음처럼 확인한다.

```bash
curl http://192.168.56.20:8080
```

`EXTERNAL-IP`가 `<pending>`이면 Service보다 먼저 MetalLB controller·speaker 상태, IP 풀과 광고 리소스, 그리고 지정한 대역의 네트워크 도달 가능 여부를 확인한다. IP가 할당됐지만 접속이 되지 않을 때는 클라이언트가 같은 L2 네트워크에 있는지와 방화벽 정책도 함께 점검한다.

---

## 6. 고정 IP와 접근 제한 시 주의점

예전 예제에서 자주 보이는 `spec.loadBalancerIP`는 Kubernetes v1.24부터 deprecated 상태다. 지원 방식은 로드 밸런서 구현체마다 다르므로, 특정 주소를 요구하는 경우에는 MetalLB의 현재 문서와 조직의 IP 주소 관리 정책에 맞는 방식으로 설정해야 한다.

또한 `LoadBalancer`를 만들었다고 해서 자동으로 안전해지는 것은 아니다. `loadBalancerSourceRanges`는 지원하는 구현체에서 허용할 원본 CIDR을 제한하는 데 사용할 수 있지만, L2 기반 MetalLB 환경에서는 네트워크 방화벽·NetworkPolicy·애플리케이션 인증을 함께 설계해야 한다. Service 하나의 설정만으로 모든 접근 경로가 차단된다고 가정하면 안 된다.

---

## 7. 정리

MetalLB는 온프레미스나 로컬 Kubernetes에서 `LoadBalancer` Service에 실제 외부 IP를 제공하는 구현체다. controller가 주소를 할당하고 speaker가 L2 또는 BGP로 그 주소의 도달 경로를 네트워크에 알린다.

처음에는 충돌 없는 작은 IP 풀과 L2 모드로 동작을 검증하는 것이 좋다. 운영 환경에서는 CNI·kube-proxy 모드·라우팅·방화벽과 주소 관리 체계를 함께 확인해야 안정적으로 사용할 수 있다.

---

## 참고 자료

* [MetalLB Installation](https://metallb.io/installation/)
* [MetalLB Configuration](https://metallb.io/configuration/)
* [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/)
