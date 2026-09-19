---
layout: post
title: "Jenkins (2) - Freestyle Job과 Credentials로 첫 빌드 만들기"
date: 2026-09-19 15:23:44 +0900
categories: ["CI/CD", "Jenkins"]
tags: ["jenkins", "ci", "freestyle-job", "credentials", "git", "gradle"]
---

## 1. 개요

Jenkins를 설치한 뒤에는 무엇을 언제 실행할지 Job으로 정의한다. 가장 단순한 Freestyle Job은 화면에서 소스 저장소, 실행 명령, 실행 뒤 동작을 설정할 수 있어 Jenkins의 기본 흐름을 익히기에 좋다.

이 글에서는 Freestyle Job의 구성 요소를 살펴보고, 민감한 값을 코드에 넣지 않는 Credentials 원칙과 Gradle 프로젝트의 첫 빌드를 만든다.

---

## 2. Freestyle Job의 구성 요소

대시보드에서 **New Item → Freestyle project**를 선택해 Job을 만든다. Job은 아래 세 요소를 중심으로 구성한다.

| 항목 | 역할 | 예시 |
| --- | --- | --- |
| Build Trigger | Job을 시작하는 조건 | 수동 실행, Webhook, 일정 |
| Source Code Management | 빌드할 코드를 가져오는 설정 | Git 저장소와 브랜치 |
| Build Steps | 실제로 실행할 명령 | `./gradlew test` |
| Post-build Actions | 실행 뒤 처리할 작업 | 결과 메일, 다른 Job 시작 |

Build를 실행할 때마다 Jenkins는 고유한 빌드 번호와 콘솔 로그를 남긴다. 오래된 로그와 결과물이 무한히 쌓이지 않도록 **Discard old builds**에서 보관 일수나 개수를 정하는 편이 좋다.

---

## 3. Credentials에 비밀값을 저장한다

비공개 Git 저장소, Docker Hub, 배포 서버에는 인증이 필요하다. 토큰과 비밀번호를 Jenkinsfile, 셸 스크립트, Job 설정의 명령 칸에 직접 쓰면 로그나 저장소를 통해 유출될 수 있다.

**Manage Jenkins → Credentials**에서 용도에 맞는 자격 증명을 추가한다.

![Jenkins Credentials 목록](/assets/img/posts/2026-09-19-CICD-Jenkins-2-Freestyle-Job과-Credentials/credentials-list.png)

| 종류 | 적합한 값 | 예시 |
| --- | --- | --- |
| Secret text | 토큰 한 개 | GitHub PAT, SonarQube 토큰 |
| Username with password | 계정과 비밀번호 또는 액세스 토큰 | Docker Hub 로그인 |
| SSH Username with private key | SSH 사용자와 개인 키 | 배포 서버 접속 |
| Secret file | 파일 형태의 비밀값 | 서비스 계정 키 파일 |

자격 증명에는 알아보기 쉬운 ID를 정한다. 예를 들어 `dockerhub-push`, `deploy-server-key`처럼 용도를 드러내면 Pipeline에서 선택하기 쉽다. Global 범위는 여러 Job이 쓸 수 있으므로 꼭 필요한 사용자와 Job만 접근하도록 권한을 제한한다. Jenkins는 Pipeline에서 값 자체가 아니라 credential ID로 참조하도록 권장한다. 자세한 유형과 범위는 [Jenkins Credentials 문서](https://www.jenkins.io/doc/book/using/using-credentials/)를 참고한다.

---

## 4. Gradle 프로젝트를 빌드한다

예제로 공개 Git 저장소를 사용한다면 **Source Code Management → Git**에서 저장소 URL과 `main` 브랜치를 지정한다. 비공개 저장소라면 앞에서 저장한 Git 자격 증명을 Credentials 드롭다운에서 선택한다.

**Build Steps → Execute shell**을 추가하고 다음 명령을 입력한다.

```bash
chmod +x gradlew
./gradlew clean test --no-daemon
```

첫 줄은 실행 권한 정보가 없는 환경에서 내려받은 Gradle Wrapper를 실행 가능하게 한다. 두 번째 줄은 이전 산출물을 정리한 뒤 테스트까지 실행한다. 패키지 파일도 만들고 싶다면 테스트가 통과한 뒤 `./gradlew bootJar --no-daemon` 또는 프로젝트에 맞는 패키징 명령을 추가한다.

**Build Now**를 눌러 실행하고, 왼쪽 빌드 번호를 선택한 뒤 **Console Output**을 연다. 테스트가 실패하면 Gradle은 실패한 테스트 이름과 위치를 출력하고, Jenkins는 해당 Build를 실패로 표시한다.

![Jenkins Console Output의 테스트 실패 결과](/assets/img/posts/2026-09-19-CICD-Jenkins-2-Freestyle-Job과-Credentials/test-failure-console.png)

예를 들어 아래 테스트는 실제 응답인 `hello jenkins` 대신 `hello`를 기대하도록 작성되어 있으므로 실패한다. 콘솔의 `HelloControllerTest.java:12`처럼 표시된 위치를 확인하면 원인을 빠르게 찾을 수 있다.

![실패를 재현한 HelloControllerTest 코드](/assets/img/posts/2026-09-19-CICD-Jenkins-2-Freestyle-Job과-Credentials/test-code-failure.png)

기대값을 실제 요구 사항에 맞게 수정하고 저장소에 반영한다.

![기대값을 수정한 HelloControllerTest 코드](/assets/img/posts/2026-09-19-CICD-Jenkins-2-Freestyle-Job과-Credentials/test-code-fixed.png)

다시 Build를 실행해 `BUILD SUCCESSFUL`과 Jenkins의 `Finished: SUCCESS`를 확인한다. 이처럼 Jenkins는 코드를 가져와 빌드뿐 아니라 테스트 실패 여부까지 일관된 로그로 남긴다.

![Jenkins Console Output의 성공 결과](/assets/img/posts/2026-09-19-CICD-Jenkins-2-Freestyle-Job과-Credentials/build-success-console.png)

---

## 5. 작업 공간과 동시 실행을 관리한다

Jenkins는 Job마다 workspace를 만들어 소스 코드와 빌드 산출물을 둔다. 이전 실행의 파일이 다음 실행에 영향을 주면 **Delete workspace before build starts** 같은 정리 옵션을 사용하거나 Build Step 첫 줄에서 프로젝트의 정리 명령을 실행한다.

같은 Job의 두 Build가 같은 파일이나 배포 대상을 건드린다면 **Do not allow concurrent builds**를 활성화한다. 반대로 서로 독립적인 테스트만 수행하고 실행 환경이 충분하다면 동시 실행을 검토할 수 있다. 중요한 것은 빠른 실행보다 결과가 섞이지 않는 것이다.

Freestyle Job은 간단한 명령을 익히기에 좋지만, 화면 설정은 코드 리뷰와 변경 이력 관리가 어렵다. 여러 단계를 지속적으로 관리하는 작업은 Pipeline과 `Jenkinsfile`로 옮기는 편이 낫다.

---

## 6. 정리

Freestyle Job은 트리거, 소스 코드, Build Step, 실행 후 작업을 화면에서 조합해 자동화를 시작하는 방식이다. Build마다 로그가 남으므로 실패 지점을 빠르게 확인할 수 있다.

토큰, 비밀번호, 개인 키는 명령이나 저장소에 기록하지 않고 Credentials에 보관한다. Job에서는 자격 증명 값이 아닌 ID를 선택해 연결하는 것이 기본 원칙이다.
