---
layout: post
title: "Jenkins (3) - GitHub Webhook과 주기적 빌드 설정하기"
date: 2026-09-19 15:23:44 +0900
categories: ["CI/CD", "Jenkins"]
tags: ["jenkins", "ci", "github", "webhook", "cron", "poll-scm"]
---

## 1. 개요

수동으로 **Build Now**를 누르는 방식은 자동화의 출발점일 뿐이다. 실제 CI는 코드가 바뀌었을 때 Jenkins가 알아서 빌드해야 한다. Jenkins에는 GitHub가 변경 사실을 알려 주는 Webhook 방식과 Jenkins가 저장소를 주기적으로 확인하는 Poll SCM 방식이 있다.

이 글에서는 두 방식의 차이를 이해하고, GitHub Webhook을 우선으로 설정하는 방법과 일정 기반 Build 설정을 정리한다.

---

## 2. Webhook과 Poll SCM을 구분한다

| 구분 | GitHub Webhook | Poll SCM |
| --- | --- | --- |
| 시작 방식 | GitHub가 변경 이벤트를 Jenkins에 전송 | Jenkins가 일정마다 Git을 확인 |
| 반응 시간 | 이벤트 직후 시작 가능 | 다음 확인 시간까지 대기 |
| 네트워크 조건 | GitHub가 Jenkins URL에 접근 가능해야 함 | Jenkins가 GitHub에 접근할 수 있으면 됨 |
| 권장 용도 | 외부에서 접근 가능한 일반적인 CI | 내부망, Webhook을 받을 수 없는 환경 |

변경이 없어도 매번 Build를 실행하는 **Build periodically**와 Poll SCM은 다르다. Poll SCM은 변경이 발견된 경우에만 Build를 시작하고, Build periodically는 변경 여부와 상관없이 정해진 시간에 실행한다.

---

## 3. Jenkins에서 GitHub Webhook 트리거를 켠다

먼저 Job의 **Configure → Build Triggers**에서 **GitHub hook trigger for GITScm polling**을 선택한다. Job의 Source Code Management에는 Git 저장소와 빌드할 브랜치를 설정해 둔다.

Jenkins는 외부에서 다음 주소로 접근할 수 있어야 한다.

```text
https://jenkins.example.com/github-webhook/
```

프로젝트 이름을 URL에 넣지 않는 점에 주의한다. Jenkins가 요청을 받은 뒤 연결된 Job의 SCM 설정을 확인해 실행 대상을 판단한다. 인터넷에 직접 노출한다면 HTTPS를 사용하고, 방화벽·리버스 프록시 설정에서 이 경로의 POST 요청이 Jenkins까지 전달되는지 확인한다.

---

## 4. GitHub 저장소에 Webhook을 추가한다

GitHub 저장소에서 **Settings → Webhooks → Add webhook**을 선택한다. 다음처럼 입력한다.

| 항목 | 값 |
| --- | --- |
| Payload URL | `https://jenkins.example.com/github-webhook/` |
| Content type | `application/json` |
| Secret | Jenkins와 GitHub 양쪽에서 검증하도록 설정한 값 |
| Events | 우선 `Just the push event` |
| Active | 활성화 |

Webhook을 저장한 뒤 GitHub의 Recent Deliveries에서 응답 상태를 확인한다. `2xx` 응답이 아니면 Payload URL, DNS, TLS 인증서, 방화벽, 리버스 프록시 경로를 차례로 점검한다. Jenkins 로그와 해당 Job의 콘솔 출력도 함께 보면 원인을 찾을 수 있다.

Webhook은 외부에서 들어오는 요청이므로 Jenkins 관리 화면을 무방비로 공개하면 안 된다. 관리자 계정에는 강한 비밀번호와 최소 권한을 적용하고, 가능하면 VPN이나 IP 허용 목록으로 관리 화면 접근을 제한한다.

---

## 5. Poll SCM과 일정 Build를 설정한다

Webhook을 쓸 수 없는 환경이라면 **Poll SCM**에 Jenkins cron 표현식을 설정한다.

```text
H/5 * * * *
```

이 표현식은 약 5분 간격으로 저장소 변경을 확인한다. Jenkins의 `H`는 여러 Job이 정확히 같은 시각에 몰리지 않도록 Job 이름을 기준으로 시간을 분산하는 해시 값이다. 단순히 `*/5 * * * *`를 쓰는 것보다 Jenkins에서는 `H/5`가 보통 더 적합하다.

매일 새벽에 데이터 동기화나 정기 점검처럼 코드 변경과 무관한 작업을 실행하려면 **Build periodically**를 사용한다.

```text
H 2 * * 1-5
```

평일 오전 2시 무렵에 한 번 실행하는 예시다. 시간대는 Jenkins Controller의 시간대를 따르므로, 서버와 컨테이너의 시간대 설정을 확인해야 한다.

---

## 6. 정리

GitHub Webhook은 변경 이벤트를 바로 Jenkins에 전달하므로 일반적인 CI에 적합하다. Jenkins가 외부에서 접근할 수 없을 때는 Poll SCM을 대안으로 사용할 수 있으며, 변경과 무관한 정기 작업은 Build periodically로 분리한다.

트리거는 Build를 시작하게 할 뿐, 어떤 코드를 검증하고 어디까지 배포할지는 Job 또는 Pipeline이 결정한다.
