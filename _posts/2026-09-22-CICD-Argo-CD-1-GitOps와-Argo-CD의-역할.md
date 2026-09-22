---
layout: post
title: "Argo CD (1) - GitOps와 Argo CD의 역할"
date: 2026-09-22 12:06:20 +0900
categories: ["CI/CD", "Argo CD"]
tags: ["cicd", "gitops", "argocd", "kubernetes", "cd"]
---

## 1. 개요

애플리케이션을 Kubernetes에 배포할 때 `kubectl apply`를 직접 실행하면 빠르게 시작할 수 있다. 하지만 환경과 클러스터가 늘어나면 누가, 언제, 어떤 설정을 바꿨는지 추적하기 어렵고, Git에 저장된 설정과 실제 클러스터의 상태가 달라질 수 있다.

GitOps는 Git 저장소에 원하는 상태를 선언하고, 클러스터 안의 에이전트가 그 상태를 지속적으로 맞추는 운영 방식이다. Argo CD는 이 방식을 Kubernetes에서 구현하는 선언적 CD(Continuous Delivery) 도구다.

---

## 2. GitOps는 무엇인가

GitOps에서 Git 저장소는 인프라와 애플리케이션 구성의 신뢰할 수 있는 단일 소스(SSOT, Single Source of Truth)가 된다. Deployment의 복제본 수, 사용할 이미지 태그, Service 설정처럼 클러스터에 있어야 할 상태를 YAML 매니페스트로 저장한다.

중요한 점은 **명령이 아니라 결과 상태를 기록한다**는 것이다. 예를 들어 "Pod를 세 개 생성하라"는 절차를 실행하는 대신, Deployment에 `replicas: 3`을 선언한다. Kubernetes와 GitOps 도구가 현재 상태를 확인하고, 실제 Pod 수를 세 개로 조정한다.

| GitOps 원칙 | 의미 |
| --- | --- |
| 선언적 구성 | 애플리케이션과 인프라의 원하는 상태를 YAML, Helm, Kustomize 등으로 표현한다. |
| 버전 관리 | Git 커밋과 Pull Request로 변경 이력, 검토, 승인 과정을 남긴다. |
| 자동 반영 | 클러스터의 에이전트가 Git의 변경을 감지해 필요한 동기화를 수행한다. |
| 지속적 조정 | 실제 상태가 선언 상태와 달라지면 차이를 알려 주거나 원하는 상태로 되돌린다. |

이 방식에서는 운영 환경을 직접 수정하는 대신 Git 변경을 먼저 제안하고 검토한다. 따라서 배포 변경의 이유와 시점을 커밋 기록에서 확인할 수 있고, 문제가 생기면 이전 커밋으로 되돌리는 흐름도 명확해진다.

---

## 3. Kubernetes CI/CD 흐름에서의 위치

CI는 소스 코드를 검사하고 테스트한 뒤 컨테이너 이미지를 빌드해 이미지 레지스트리에 저장한다. CD는 검증된 이미지를 어떤 환경에 어떤 설정으로 배포할지 담당한다. Argo CD는 주로 이 CD 단계에서 동작한다.

```text
애플리케이션 코드 변경
        ↓
CI: 테스트 · 컨테이너 이미지 빌드 · 레지스트리 푸시
        ↓
배포 매니페스트의 이미지 태그 변경과 Git push
        ↓
Argo CD: Git의 원하는 상태와 클러스터 상태 비교 · 동기화
        ↓
Kubernetes: 새 이미지로 애플리케이션 실행
```

이미지를 레지스트리에 푸시하는 것만으로 실행 중인 Deployment가 자동으로 바뀌지는 않는다. GitOps에서는 보통 CI가 매니페스트의 이미지 태그를 새 버전으로 변경하고, Argo CD가 그 Git 변경을 클러스터에 반영한다.

---

## 4. Argo CD가 동작하는 방식

Argo CD에 `Application`을 만들면, 어느 Git 저장소의 어느 경로를 어느 Kubernetes 클러스터와 namespace에 배포할지 정의한다. Application Controller는 Git에서 읽은 원하는 상태와 클러스터의 현재 상태를 계속 비교한다.

두 상태가 다르면 Application은 `OutOfSync` 상태가 된다. 사용자가 동기화를 실행하거나 자동 동기화를 설정했다면 Argo CD가 매니페스트를 적용하여 상태를 맞춘다. 이 비교하고 맞추는 과정을 조정(Reconciliation)이라고 한다.

| 구성 요소 | 역할 |
| --- | --- |
| API Server | Web UI, CLI, CI/CD 도구의 요청을 받고 인증·권한·애플리케이션 관리를 처리한다. |
| Repository Server | Git 저장소를 조회하고 Helm, Kustomize 등의 소스를 Kubernetes 매니페스트로 생성한다. |
| Application Controller | 원하는 상태와 현재 상태를 비교하고 동기화 상태 및 리소스 상태를 관리한다. |

Argo CD는 매니페스트를 직접 작성하는 도구가 아니다. 이미 Git에 선언한 구성을 기준으로 Helm 차트나 Kustomize 설정을 렌더링하고, 클러스터에 반영할지 관리하는 도구다.

---

## 5. Argo CD를 사용하는 이유

GitOps 흐름을 사용하면 개발·운영 환경의 설정을 같은 방식으로 관리할 수 있다. Pull Request를 이용하면 운영 변경도 코드 변경처럼 검토할 수 있고, Git 이력으로 어떤 변경이 클러스터에 영향을 주었는지 추적할 수 있다.

또한 Argo CD는 동기화 여부와 리소스 상태를 UI와 CLI에서 보여 준다. Git에는 없는 리소스가 남았거나, 누군가 클러스터의 Deployment를 직접 수정한 경우처럼 구성 드리프트(configuration drift)가 생겼을 때도 차이를 확인할 수 있다.

다만 Git 저장소에 Secret 원문을 커밋해서는 안 된다. 운영 환경에서는 Sealed Secrets, External Secrets 같은 별도 Secret 관리 방식과 RBAC, 승인 절차를 함께 설계해야 한다.

---

## 6. 정리

GitOps는 Git을 원하는 상태의 기준으로 삼고, 변경을 버전 관리와 검토 흐름으로 처리하는 방식이다. Argo CD는 Git의 선언 상태와 Kubernetes 클러스터의 실제 상태를 비교해 이 방식을 구현한다.
