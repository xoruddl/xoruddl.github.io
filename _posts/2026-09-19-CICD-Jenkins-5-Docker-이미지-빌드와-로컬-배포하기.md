---
layout: post
title: "Jenkins (5) - Docker 이미지 빌드와 로컬 배포하기"
date: 2026-09-19 15:23:44 +0900
categories: ["CI/CD", "Jenkins"]
tags: ["jenkins", "cd", "docker", "spring-boot", "pipeline", "poll-scm", "health-check"]
---

## 1. 개요

앞선 글에서는 Jenkins Pipeline으로 Spring Boot 프로젝트를 테스트했다. 이번에는 테스트를 통과한 JAR를 Docker 이미지로 만들고, 기존 컨테이너를 새 이미지로 교체해 로컬에서 실행한다.

이 글의 Jenkins는 Docker Desktop에서 컨테이너로 실행 중인 로컬 학습 환경을 기준으로 한다. GitHub Webhook을 받을 수 없으므로 Jenkins가 1분마다 저장소 변경을 확인하고, 변경이 있으면 테스트·빌드·배포·상태 확인을 차례로 수행한다.

```text
Git 변경 → Poll SCM → 테스트 → JAR 생성 → Docker 이미지 빌드 → 컨테이너 교체 → Health Check
```

---

## 2. 배포 환경과 Dockerfile을 준비한다

이 예제에서 Jenkins Job은 Docker 명령과 `curl`을 실행할 수 있어야 한다. Jenkins를 Docker 컨테이너로 실행했다면 Jenkins 컨테이너 안에 Docker CLI와 `curl`이 있어야 하며, Docker 데몬에 접근할 수 있도록 별도 구성이 필요하다.

Docker 소켓을 Jenkins 컨테이너에 연결하면 Jenkins Job이 호스트 Docker를 제어할 수 있다. 이는 로컬 학습에는 편리하지만 권한 범위가 매우 넓으므로, 운영 환경에서는 Docker 권한을 가진 전용 Agent를 분리하는 편이 안전하다.

프로젝트 루트에 `Dockerfile`을 만든다. JAR는 Pipeline의 Build Stage에서 미리 만들므로, Dockerfile은 실행에 필요한 JRE와 JAR만 담는다.

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app
COPY build/libs/jenkins_test-0.0.1-SNAPSHOT.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

`jenkins_test-0.0.1-SNAPSHOT.jar`는 실제 `bootJar` 결과 파일명과 같아야 한다. 프로젝트 버전이나 `archivesBaseName`을 바꾸었다면 이 경로도 함께 수정한다. 환경마다 달라지는 비밀번호나 API 키는 이미지에 복사하지 말고 환경 변수 또는 Secret으로 주입한다.

---

## 3. Jenkinsfile로 테스트·빌드·배포 흐름을 정의한다

프로젝트 루트의 `Jenkinsfile`에 다음 Pipeline을 작성한다. Pipeline Job은 **Pipeline script from SCM** 방식으로 이 파일을 읽도록 설정한다.

```groovy
pipeline {
    // 실행 가능한 Jenkins Agent에서 Pipeline 전체를 실행한다.
    agent any

    options {
        // 이전 Build가 끝나기 전에는 같은 Job의 새 Build를 시작하지 않는다.
        disableConcurrentBuilds()
        // Build 로그와 실행 기록은 최근 10개만 보관한다.
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    // 로컬 Jenkins라 GitHub Webhook을 받을 수 없으므로 1분마다 저장소 변경을 확인한다.
    triggers {
        pollSCM('* * * * *')
    }

    environment {
        // Docker 이미지 이름이다.
        IMAGE = 'jenkins-test'
        // 실행할 Docker 컨테이너 이름이다.
        CONTAINER = 'jenkins-test-app'
        // 호스트에서 애플리케이션에 접근할 포트다.
        APP_PORT = '8081'
    }

    stages {
        stage('Test') {
            steps {
                // Git에서 받은 Gradle Wrapper에 실행 권한을 부여한다.
                sh 'chmod +x gradlew'
                // 이전 산출물을 지우고 단위 테스트를 실행한다.
                sh './gradlew clean test --no-daemon'
            }
            post {
                always {
                    // 테스트 성공 여부와 관계없이 JUnit XML 결과를 Jenkins에 등록한다.
                    junit 'build/test-results/test/*.xml'
                }
            }
        }

        stage('Build') {
            steps {
                // Dockerfile이 복사할 실행 가능한 Spring Boot JAR를 생성한다.
                sh './gradlew bootJar --no-daemon'
            }
        }

        stage('Docker Build') {
            steps {
                // 이번 Build 번호와 latest 태그를 가진 Docker 이미지를 만든다.
                sh 'docker build -t $IMAGE:$BUILD_NUMBER -t $IMAGE:latest .'
            }
        }

        stage('Deploy') {
            steps {
                // 같은 이름의 이전 컨테이너를 제거한다. 없으면 오류를 무시한다.
                sh 'docker rm -f $CONTAINER || true'
                // 호스트 8081 포트와 컨테이너 8080 포트를 연결해 새 이미지를 실행한다.
                sh 'docker run -d --name $CONTAINER -p $APP_PORT:8080 $IMAGE:$BUILD_NUMBER'
            }
        }

        stage('Health Check') {
            steps {
                // Jenkins 컨테이너에서 호스트로 나가는 주소는 host.docker.internal이다.
                retry(10) {
                    // 애플리케이션이 시작될 시간을 주고 최대 10번 재시도한다.
                    sleep 3
                    // 2xx 응답이 아니거나 연결에 실패하면 이 시도를 실패로 처리한다.
                    sh 'curl -fs http://host.docker.internal:$APP_PORT/hello'
                }
            }
        }
    }
}
```

Declarative Pipeline은 첫 Agent를 할당할 때 저장소의 소스 코드를 기본으로 checkout한다. 만약 Job 설정에서 기본 checkout을 끄거나 동작이 달라졌다면 `stage('Checkout') { steps { checkout scm } }`을 Test Stage 앞에 추가한다.

---

## 4. Pipeline 옵션과 Stage의 역할을 이해한다

| 설정 또는 Stage | 하는 일 |
| --- | --- |
| `disableConcurrentBuilds()` | 같은 Job의 두 Build가 동시에 컨테이너를 지우고 실행하지 않도록 막는다. |
| `buildDiscarder(...)` | 최근 10개 Build만 남겨 로그와 작업 공간이 계속 쌓이는 것을 줄인다. |
| `pollSCM('* * * * *')` | 매분 Git 저장소의 변경을 확인하고, 변경이 있을 때만 Build를 시작한다. |
| Test | Gradle 테스트를 실행하고, 성공·실패와 관계없이 JUnit XML 결과를 Jenkins에 올린다. |
| Build | `bootJar`로 Dockerfile이 복사할 실행 JAR를 생성한다. |
| Docker Build | Build 번호 태그와 `latest` 태그를 모두 붙여 이미지를 만든다. |
| Deploy | 기존 컨테이너를 제거한 뒤 이번 Build 번호의 이미지로 새 컨테이너를 실행한다. |
| Health Check | 새 컨테이너의 `/hello` 응답을 확인한다. |

`pollSCM('* * * * *')`는 매분 확인하므로 로컬 실습에는 편리하지만, 저장소 요청이 계속 발생한다. 외부에서 접근 가능한 Jenkins를 구성한 뒤에는 3편에서 다룬 GitHub Webhook으로 바꾸는 편이 효율적이다.

`BUILD_NUMBER`는 Jenkins Job의 실행 번호다. 이미지는 예를 들어 `jenkins-test:12`와 `jenkins-test:latest` 두 태그를 받는다. Deploy에서는 `latest`가 아니라 `jenkins-test:12`처럼 이번 Build의 태그를 사용하므로, 어떤 Build가 실행 중인지 추적할 수 있다.

---

## 5. 컨테이너 교체와 Health Check를 확인한다

Deploy Stage의 `docker rm -f $CONTAINER || true`는 같은 이름의 기존 컨테이너가 있으면 중지·삭제한다. 컨테이너가 아직 없는 첫 실행에서는 `docker rm`이 실패하지만, `|| true`가 그 실패를 무시하므로 Pipeline은 계속 진행한다.

다음 `docker run`은 호스트의 `8081` 포트를 컨테이너의 `8080` 포트와 연결한다. 따라서 브라우저에서는 `http://localhost:8081/hello`으로 애플리케이션을 확인한다.

![초기 배포 뒤 localhost 8081 포트의 hello 응답](/assets/img/posts/2026-09-19-CICD-Jenkins-5-Docker-이미지-빌드와-로컬-배포하기/initial-health-check.png)

Health Check는 Jenkins 컨테이너 내부에서 실행된다. 이때 컨테이너 내부의 `localhost`는 Jenkins 컨테이너 자신이므로, Docker Desktop 환경에서는 호스트를 가리키는 `host.docker.internal`을 사용한다.

```bash
curl -fs http://host.docker.internal:8081/hello
```

`-f`는 HTTP 오류 응답을 명령 실패로 처리하고, `-s`는 진행 출력을 숨긴다. 애플리케이션 시작에 시간이 걸릴 수 있으므로 `retry(10)`과 `sleep 3`으로 최대 약 30초 동안 재시도한다. 모두 실패하면 Health Check Stage가 실패해 배포 이상을 Jenkins에서 바로 확인할 수 있다.

Linux Docker 환경에는 `host.docker.internal` 이름이 자동으로 없을 수 있다. 이 글의 주소는 macOS·Windows Docker Desktop 기준이며, Linux에서는 Jenkins 컨테이너를 실행할 때 `--add-host=host.docker.internal:host-gateway` 같은 호스트 매핑을 추가하거나 네트워크 구성을 조정해야 한다.

---

## 6. 변경 사항이 자동 배포되는지 확인한다

`/hello`의 응답을 바꾸고 Git 저장소에 push한다. 최대 1분 안에 Poll SCM이 변경을 감지하면 새 Build가 시작된다. Test와 Health Check가 모두 성공하면 브라우저의 `http://localhost:8081/hello`에서 바뀐 응답을 확인할 수 있다.

![코드 변경 뒤 재배포된 localhost 8081 포트의 hello 응답](/assets/img/posts/2026-09-19-CICD-Jenkins-5-Docker-이미지-빌드와-로컬-배포하기/redeployed-health-check.png)

Build가 실패하면 Jenkins의 Stage View와 Console Output을 확인한다. 테스트 실패라면 Deploy Stage까지 도달하지 않으므로, 검증되지 않은 코드가 기존 컨테이너를 교체하지 않는다.

---

## 7. 정리

이 Pipeline은 저장소 변경을 감지해 테스트, JAR 생성, Docker 이미지 빌드, 기존 컨테이너 교체, HTTP 상태 확인을 순서대로 수행한다. `disableConcurrentBuilds()`와 Build 번호 태그를 사용하면 여러 실행이 같은 컨테이너를 뒤섞는 문제를 줄일 수 있다.

현재 구성은 한 대의 로컬 Docker 호스트에 배포하는 학습용 CD다. 실제 운영에서는 Webhook, 전용 Docker Agent, 별도 배포 서버 또는 컨테이너 오케스트레이터, 무중단 배포 전략을 추가로 고려해야 한다.
