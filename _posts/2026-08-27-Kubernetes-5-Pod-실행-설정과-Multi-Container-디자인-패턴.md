---
layout: post
title: "Kubernetes (5) - Pod 실행 설정과 Multi-Container 디자인 패턴"
date: 2026-08-27 18:43:18 +0900
categories: ["Kubernetes"]
tags: ["kubernetes", "pod", "container", "sidecar", "hostnetwork", "쿠버네티스"]
---

Pod는 하나 이상의 컨테이너를 함께 실행하는 Kubernetes의 최소 배포 단위다. 하지만 컨테이너를 한 Pod에 넣는다고 모두 같은 방식으로 협력하는 것은 아니다. 애플리케이션의 생명주기, 네트워크, 데이터 공유가 밀접할 때만 Multi-Container Pod를 선택해야 한다.

이번 글에서는 Pod와 컨테이너 런타임의 역할을 구분하고, Multi-Container Pod에서 자주 언급되는 Sidecar·Ambassador·Adapter 패턴과 컨테이너 실행 설정을 정리한다.

---

## 1. Pod는 관리 단위, 컨테이너는 실행 단위

Kubernetes API에서 생성·조회·삭제하는 객체는 Pod다. 실제로 컨테이너 프로세스를 만들고 실행하는 일은 각 노드의 kubelet이 컨테이너 런타임에 요청해 처리한다. 현재 Kubernetes 환경에서는 containerd나 CRI-O 같은 CRI 호환 런타임을 사용하는 구성이 일반적이다.

```bash
# Pod의 실행 상태, IP, 배치 노드 확인
kubectl get pods -o wide

# Pod 이벤트와 컨테이너 상태 확인
kubectl describe pod sample-pod
```

Pod 안의 컨테이너는 네트워크 네임스페이스를 공유하므로 같은 Pod의 다른 컨테이너 포트에는 `localhost`로 접근할 수 있다. 반면 컨테이너별 파일 시스템은 기본적으로 분리된다. 파일이나 설정을 함께 써야 한다면 `emptyDir` 같은 공유 볼륨을 명시적으로 마운트해야 한다.

---

## 2. Stateless와 Stateful 워크로드 구분하기

Stateless 애플리케이션은 인스턴스 자체에 사용자 세션이나 영속 데이터를 보관하지 않아, 어느 Pod가 요청을 처리해도 같은 방식으로 동작하도록 설계한다. 일반적인 웹 API나 프런트엔드는 Deployment로 여러 복제본을 운영하기에 적합한 경우가 많다.

반대로 Stateful 애플리케이션은 안정적인 네트워크 식별자, 정해진 시작·종료 순서, 영속 데이터처럼 인스턴스별 상태를 고려해야 한다. 데이터베이스나 메시지 브로커처럼 상태를 다루는 워크로드에는 StatefulSet과 PersistentVolume을 함께 검토한다.

| 구분 | Stateless | Stateful |
| --- | --- | --- |
| 인스턴스 교체 | 대체로 자유롭게 교체 가능 | 인스턴스별 데이터·식별자를 고려해야 함 |
| 대표 리소스 | Deployment | StatefulSet |
| 데이터 보관 | 외부 저장소에 분리하는 경우가 많음 | 영속 볼륨과 연결하는 경우가 많음 |

---

## 3. Multi-Container Pod 디자인 패턴

여러 컨테이너를 한 Pod에 배치하는 것은 하나의 선택지일 뿐, 그 자체가 곧 Sidecar 패턴은 아니다. 함께 배포하고 네트워크를 공유해야 하는 이유가 분명할 때 다음과 같은 역할 분리를 적용할 수 있다.

| 패턴 | 보조 컨테이너 역할 | 통신·공유 방식 | 예시 |
| --- | --- | --- | --- |
| Sidecar | 주 애플리케이션의 보조 기능 수행 | 공유 볼륨 또는 localhost | 로그 전달, 설정 동기화, 프록시 |
| Ambassador | 외부 시스템 접속을 대신 중계 | 주 컨테이너가 localhost로 접속 | DB 연결 프록시, 서비스 메시 프록시 |
| Adapter | 애플리케이션의 출력 형식을 변환 | 공유 파일·로컬 엔드포인트 | 로그·메트릭 형식 변환 |

Sidecar는 애플리케이션의 본래 기능은 유지하면서 로그 수집, 인증 프록시, 설정 갱신 같은 부가 기능을 분리할 때 쓰인다. Ambassador는 주 컨테이너가 외부 시스템의 구체적인 주소나 연결 방식을 직접 알지 않도록 중간 계층을 둔다. Adapter는 애플리케이션이 내보내는 데이터 형식을 수집 시스템이 이해하는 형태로 바꾼다.

다만 두 컨테이너가 독립적으로 배포·확장돼야 한다면 별도 Pod로 나누는 편이 낫다. 한 Pod의 컨테이너는 함께 스케줄링되고 같은 Pod 수명주기를 공유하므로, 불필요하게 묶으면 운영과 확장이 어려워질 수 있다.

---

## 4. 이미지의 기본 실행 명령 덮어쓰기

Docker 이미지의 `ENTRYPOINT`와 `CMD`는 Kubernetes Pod 명세에서 각각 `command`와 `args`로 바꿔 지정할 수 있다. 이를 이용하면 이미지를 다시 빌드하지 않고도 컨테이너의 시작 명령을 실습·검증 목적에 맞게 바꿀 수 있다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sample-entrypoint
spec:
  containers:
    - name: nginx-container
      image: nginx
      command: ["/bin/sleep"]
      args: ["3600"]
      workingDir: /tmp
```

```bash
kubectl apply -f sample-entrypoint.yaml
kubectl exec -it sample-entrypoint -- /bin/sh
```

`workingDir`는 컨테이너 프로세스가 시작할 작업 디렉터리를 지정한다. Dockerfile의 `WORKDIR`와 같은 목적의 설정이지만, Pod 명세에서 지정하면 이미지의 기본값을 덮어쓸 수 있다.

컨테이너 안에서 임시로 패키지를 설치하거나 파일을 수정할 수는 있다. 다만 Pod가 교체되면 그 변경은 사라질 수 있으므로, 필요한 도구와 설정은 이미지 또는 매니페스트로 재현 가능하게 관리하는 편이 안전하다.

---

## 5. hostNetwork는 신중하게 사용하기

일반적으로 Pod는 노드 네트워크와 분리된 네트워크 공간에서 Pod IP를 받는다. `hostNetwork: true`를 설정하면 Pod가 노드의 네트워크 네임스페이스를 사용한다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: host-network-pod
spec:
  hostNetwork: true
  containers:
    - name: nginx
      image: nginx
      ports:
        - containerPort: 80
```

이 설정을 사용하면 컨테이너 포트가 노드의 포트와 직접 충돌할 수 있다. 따라서 일반적인 애플리케이션 Pod에는 기본 Pod 네트워크와 Service를 우선 사용하고, 노드 네트워크 접근이 꼭 필요한 시스템 수준 워크로드에서만 필요성과 보안 영향을 검토한 뒤 적용한다.

---

## 6. Pod 이름 규칙

Pod 이름은 보통 DNS 서브도메인 규칙을 따라 영문 소문자, 숫자, `-`, `.`을 사용한다. 이름은 영문 소문자나 숫자로 시작하고 끝나야 하며, 최대 길이는 253자다.

```yaml
metadata:
  name: api-server-1
```

실습용 Pod는 사람이 알아보기 쉬운 이름을 직접 붙일 수 있다. Deployment나 ReplicaSet이 만드는 Pod에는 충돌을 피하기 위한 접미사가 자동으로 추가된다.

---

## 7. 정리

Pod는 Kubernetes가 관리하는 배포 단위이고, 컨테이너의 실제 실행은 노드의 kubelet과 컨테이너 런타임이 담당한다. 같은 Pod의 컨테이너는 localhost 네트워크를 공유하지만, 파일을 공유하려면 볼륨을 별도로 선언해야 한다.

Multi-Container Pod는 Sidecar, Ambassador, Adapter처럼 분명한 협력 목적이 있을 때 사용한다. 독립적인 배포와 확장이 필요한 구성 요소까지 한 Pod에 묶지 않는 것이 중요하다. `command`, `args`, `workingDir`, `hostNetwork` 같은 실행 설정은 강력하지만, 특히 `hostNetwork`는 포트 충돌과 격리 수준을 고려해 제한적으로 사용해야 한다.
