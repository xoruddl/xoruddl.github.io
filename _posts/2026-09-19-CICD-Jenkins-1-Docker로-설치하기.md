---
layout: post
title: "Jenkins (1) - CI/CD 자동화와 Docker 설치"
date: 2026-09-19 15:23:44 +0900
categories: ["CI/CD", "Jenkins"]
tags: ["jenkins", "ci-cd", "docker", "controller", "agent"]
---

## 1. 개요

여러 사람이 코드를 합치면 빌드, 테스트, 배포 확인을 반복해야 한다. Jenkins는 이런 반복 작업을 이벤트나 일정에 따라 실행하는 오픈 소스 자동화 서버다. Git 저장소에서 코드를 가져와 테스트하고, 이미지를 만들고, 결과를 알리는 CI/CD 흐름을 한 곳에서 구성할 수 있다.

이 글에서는 Jenkins가 어떤 방식으로 작업을 나누는지 살펴보고, Docker Compose로 안전하게 첫 Jenkins 컨테이너를 실행한다.

---

## 2. Jenkins는 자동화 흐름을 실행한다

Jenkins의 작업은 보통 다음 순서로 연결된다.

```text
Git push → 소스 가져오기 → 빌드 → 테스트 → 이미지 생성 → 배포 → 결과 알림
```

모든 프로젝트가 이 단계를 전부 사용하지는 않는다. 예를 들어 CI에서는 빌드와 테스트까지만, CD에서는 검증된 결과물을 실제 서버까지 전달한다. Jenkins는 방대한 플러그인 생태계를 통해 Git, Gradle, Maven, Docker, Slack 등 다양한 도구와 연결할 수 있다. GitHub Actions도 같은 종류의 작업을 Action과 워크플로 단계로 구성할 수 있다.

| 구성 요소 | 하는 일 |
| --- | --- |
| Controller | Job을 관리하고 실행을 예약하며 Agent에 일을 배정한다. |
| Agent | 실제 빌드·테스트·배포 명령을 실행하는 노드다. |
| Job | 자동화 작업의 단위다. Freestyle Job 또는 Pipeline Job이 대표적이다. |
| Build | Job을 한 번 실행한 기록이다. 빌드 번호, 로그, 결과물이 함께 남는다. |
| Plugin | Git, Pipeline, 알림 등 기본 설치에 없는 기능을 제공한다. |

예전 자료에서는 Controller를 `Master`라고 부르기도 하지만, 현재 Jenkins 문서와 화면에서는 **Controller**라는 표현을 사용한다. 작은 실습에서는 Controller가 빌드까지 실행해도 되지만, 실제 환경에서는 빌드 도구와 권한을 분리한 Agent에서 작업을 수행하는 편이 안전하고 확장하기 쉽다.

---

## 3. Docker로 Jenkins를 실행한다

Docker 설치가 끝난 환경에서 빈 디렉터리를 만들고 `compose.yaml` 파일을 작성한다. Jenkins 데이터는 named volume에 보관하므로 컨테이너를 다시 만들어도 설정과 Job이 유지된다.

```yaml
services:
  jenkins:
    image: jenkins/jenkins:lts-jdk21
    container_name: jenkins
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "50000:50000"
    volumes:
      - jenkins_home:/var/jenkins_home

volumes:
  jenkins_home:
```

다음 명령으로 컨테이너를 백그라운드에서 시작한다.

```bash
docker compose up -d
docker compose ps
```

`8080`은 Jenkins 웹 화면 포트다. `50000`은 inbound Agent를 연결할 때 사용할 수 있는 포트이며, Agent 연결 방식을 사용하지 않는다면 외부에 공개할 필요가 없다. 방화벽이나 보안 그룹에서는 Jenkins를 관리할 사람의 IP만 `8080`에 접근하도록 제한한다.

Jenkins 컨테이너에 호스트의 `/var/run/docker.sock`을 곧바로 연결하거나 소켓 권한을 `666`으로 바꾸면, Jenkins 작업이 호스트 Docker를 강하게 제어할 수 있게 된다. 첫 설치에서는 이 구성을 넣지 않는다. Docker 이미지를 빌드할 때는 뒤에서 별도 Agent에 필요한 Docker 권한을 최소 범위로 부여한다.

---

## 4. 초기 관리자 계정 만들기

초기 비밀번호를 확인한다.

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

브라우저에서 `http://서버주소:8080`에 접속하고, 출력된 비밀번호를 입력한다. 그다음 설치 마법사에서 권장 플러그인을 설치하고 관리자 계정을 만든다. 플러그인은 나중에 **Manage Jenkins → Plugins**에서 추가하거나 제거할 수 있다.

Docker 공식 이미지의 LTS 태그는 장기 지원 버전을 따른다. 운영 환경에서는 `lts-jdk21` 같은 가변 태그 대신 검증한 구체 버전으로 고정하고, 업데이트 전 백업과 테스트 환경 검증을 거치는 것이 좋다. Jenkins의 Docker 설치 요구 사항과 초기 비밀번호 확인 방법은 [공식 Docker 설치 문서](https://www.jenkins.io/doc/book/installing/docker/)에서 확인할 수 있다.

---

## 5. 설치 상태 확인하기

Jenkins 화면에서 **Manage Jenkins**를 열어 시스템 정보와 플러그인 상태를 확인한다. 컨테이너 로그도 함께 확인할 수 있다.

```bash
docker compose logs --tail=100 jenkins
```

---

## 6. 정리

Jenkins는 Git 변경을 시작점으로 빌드, 테스트, 배포 같은 반복 작업을 연결하는 자동화 서버다. Controller가 작업을 관리하고 Agent가 실제 명령을 실행하도록 역할을 나눌 수 있다.

Docker Compose와 named volume을 사용하면 Jenkins를 비교적 간단하게 실행하고 데이터를 유지할 수 있다. 다만 관리 화면과 Docker 권한은 빌드 권한으로 이어질 수 있으므로, 처음부터 외부 접근과 권한 범위를 좁게 유지해야 한다.
