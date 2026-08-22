---
layout: post
title: "Docker (13) - Docker Compose로 다중 컨테이너 애플리케이션 실행하기"
date: 2026-08-21 19:00:39 +0900
categories: ["Docker"]
tags: ["docker", "docker compose", "컨테이너", "오케스트레이션", "도커"]
---

Dockerfile은 하나의 애플리케이션을 이미지로 패키징하는 데 적합하다. 하지만 웹 프론트엔드, 백엔드 API, 데이터베이스처럼 여러 컴포넌트로 구성된 애플리케이션을 실행하려면 각 컨테이너의 이미지, 포트, 환경 변수, 볼륨, 네트워크를 함께 관리해야 한다.

**Docker Compose**는 이런 애플리케이션 스택의 원하는 상태를 YAML 파일에 선언하고, 여러 서비스를 한 번에 생성·실행·중지할 수 있게 해주는 도구다. 반복해서 입력하던 `docker run` 옵션을 코드로 남길 수 있으므로 개발과 테스트 환경을 재현하기도 쉬워진다.

---

## 1. Docker Compose란

Docker Compose 파일에는 애플리케이션을 구성하는 서비스와 각 서비스의 설정을 작성한다. 예를 들어 어떤 이미지를 사용할지, 어떤 포트를 열지, 데이터를 어디에 보관할지, 어떤 환경 변수를 전달할지를 하나의 파일에 정의할 수 있다.

Compose는 파일에 선언된 설정을 바탕으로 Docker API에 요청해 컨테이너, 네트워크, 볼륨 등 필요한 Docker 객체를 생성한다. 같은 Compose 프로젝트에 속한 서비스는 기본 네트워크에 함께 연결되므로, 일반적으로 컨테이너 IP 주소 대신 서비스 이름으로 서로 통신할 수 있다.

| 구분 | `docker run` | Docker Compose |
| --- | --- | --- |
| 설정 방식 | 명령어 옵션을 매번 입력 | YAML 파일에 선언 |
| 여러 컨테이너 실행 | 컨테이너별로 실행 순서 관리 | `up` 명령 한 번으로 실행 |
| 설정 공유와 재현 | 명령어를 따로 문서화해야 함 | Compose 파일을 버전 관리 가능 |
| 네트워크 구성 | 직접 생성·연결 가능 | 프로젝트 기본 네트워크를 자동 생성 |

`docker compose up`은 정의된 서비스를 생성하고 실행하며, `docker compose down`은 실행 중인 서비스를 정지하고 Compose가 만든 컨테이너와 네트워크를 정리한다.

```bash
# 서비스 생성 및 백그라운드 실행
docker compose up -d

# 서비스 상태 확인
docker compose ps

# 서비스 정지 및 Compose 네트워크 삭제
docker compose down
```

---

## 2. 설치와 Compose 파일 이름

Docker Desktop을 설치한 Windows와 macOS 환경에는 Docker Compose가 기본으로 포함되어 있으므로 별도 설치가 필요하지 않다. 현재는 Docker CLI의 하위 명령으로 사용하는 `docker compose` 형식이 표준이다.

```bash
docker compose version
```

리눅스에서는 Docker Engine 설치 방식에 따라 Compose 플러그인을 별도로 설치해야 할 수 있다. 과거에는 독립 실행 파일을 설치한 뒤 `docker-compose --version`처럼 하이픈이 있는 명령을 사용하기도 했지만, 새 환경에서는 Compose 플러그인을 설치하고 `docker compose`를 사용하는 편이 좋다.

Compose 파일은 보통 프로젝트 최상위 디렉터리에 다음 이름 중 하나로 만든다.

```text
compose.yaml
compose.yml
docker-compose.yaml
docker-compose.yml
```

특별한 이유가 없다면 최신 문서에서 주로 사용하는 `compose.yaml`을 선택하면 된다. 다른 파일명을 사용하려면 `-f` 옵션으로 파일을 지정할 수 있다.

```bash
docker compose -f dev-compose.yaml up -d
```

---

## 3. Apache 웹 서버를 Compose로 실행하기

다음 명령은 `httpd` 이미지를 사용해 Apache 컨테이너를 백그라운드에서 실행하고, 호스트의 8080 포트를 컨테이너의 80 포트에 연결한다.

```bash
docker run --name apache_1 -d -p 8080:80 httpd
```

같은 내용을 Compose 파일로 옮기면 다음과 같다.

```yaml
services:
  apache_1:
    image: httpd
    ports:
      - "8081:80"
    restart: always
```

`services` 아래의 `apache_1`은 Compose에서 사용하는 서비스 이름이다. `image`는 실행할 이미지, `ports`는 `호스트 포트:컨테이너 포트` 형식의 포트 매핑을 뜻한다. `restart: always`는 컨테이너가 종료되었을 때 Docker가 다시 시작하도록 하는 재시작 정책이다.

파일을 저장한 디렉터리에서 다음 명령을 실행한다.

```bash
docker compose up -d
docker compose ps
```

`-d` 옵션은 서비스를 백그라운드에서 실행한다. 브라우저에서 `http://localhost:8081`에 접속하거나 `curl localhost:8081`을 실행해 Apache 응답을 확인할 수 있다.

---

## 4. MariaDB 설정을 Compose 파일로 관리하기

데이터베이스 컨테이너는 포트뿐 아니라 초기 비밀번호, 데이터 저장 위치, 재시작 정책까지 함께 지정해야 하는 경우가 많다. 이를 `docker run`으로 실행하면 명령이 길어진다.

```bash
docker run -d --name mariadb-server \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -v ~/mariadb/data:/var/lib/mysql \
  --restart always \
  mariadb:10.4.6
```

Compose에서는 같은 설정을 다음처럼 구조적으로 표현할 수 있다.

```yaml
services:
  mariadb:
    image: mariadb:10.4.6
    container_name: mariadb-server
    restart: always
    ports:
      - "3307:3306"
    volumes:
      - ./data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD: your_password
```

| 항목 | 역할 |
| --- | --- |
| `container_name` | 생성할 컨테이너 이름을 명시적으로 지정 |
| `ports` | 호스트 3307 포트와 MariaDB의 3306 포트를 연결 |
| `volumes` | 프로젝트의 `data` 디렉터리를 데이터 저장 경로에 마운트 |
| `environment` | 컨테이너 시작에 필요한 환경 변수 전달 |
| `restart` | Docker 재시작 또는 컨테이너 종료 시 적용할 재시작 정책 |

실행 명령은 Apache 예제와 동일하다.

```bash
docker compose up -d
docker compose ps
```

비밀번호를 Compose 파일에 평문으로 기록하는 방식은 실습에는 편리하지만, Git 저장소에 올리는 설정 파일에는 적합하지 않다. 실제 환경에서는 `.env` 파일을 Git 추적에서 제외하거나, 배포 환경의 시크릿 관리 기능을 사용해 민감한 값을 분리하는 것이 좋다.

---

## 5. 서비스 간 통신과 기본 네트워크

`docker compose up`을 실행하면 Compose는 프로젝트용 기본 네트워크를 자동으로 만든다. 생성된 네트워크는 다음 명령으로 확인할 수 있다.

```bash
docker network ls
```

예를 들어 API 서비스와 위의 `mariadb` 서비스가 같은 Compose 파일에 정의되어 있다면, API 컨테이너는 데이터베이스 주소로 `mariadb:3306`을 사용할 수 있다. 여기서 `mariadb`는 IP 주소가 아니라 서비스 이름이다.

```yaml
services:
  api:
    image: example-api:1.0
    environment:
      DB_HOST: mariadb
      DB_PORT: 3306

  mariadb:
    image: mariadb:10.4.6
    environment:
      MYSQL_ROOT_PASSWORD: your_password
```

컨테이너 사이의 통신에는 컨테이너 포트인 3306을 사용한다. 외부에서 데이터베이스에 접속할 때만 `ports`에 공개한 호스트 포트(예: 3307)가 필요하다. 서비스 이름을 사용하면 컨테이너가 다시 만들어져 IP 주소가 바뀌어도 애플리케이션 설정을 유지할 수 있다.

---

## 6. Docker Compose의 활용 범위

Docker Compose는 로컬 개발과 테스트 환경에서 특히 유용하다. 팀원이 저장소를 받은 뒤 Compose 파일 하나로 API, 데이터베이스, 캐시 같은 의존 서비스를 같은 방식으로 실행할 수 있기 때문이다.

다만 Compose는 다양한 운영 관리 기능을 모두 제공하는 플랫폼은 아니다. 대규모 운영 환경에서는 자동 확장, 고장 난 인스턴스의 복구, 세밀한 배포 전략, 모니터링 같은 요구가 생길 수 있다. 이런 환경에서는 Docker Swarm이나 Kubernetes 같은 오케스트레이션 도구를 함께 검토하는 것이 일반적이다.

즉 Compose는 여러 컨테이너의 구성을 코드로 표현하고 간단히 실행·관리하는 도구이며, 복잡한 클러스터 운영 기능을 대신하는 도구로 이해하기보다는 개발과 테스트 환경을 일관되게 만드는 출발점으로 활용하면 좋다.

---

## 7. 정리

Docker Compose는 여러 컨테이너로 구성된 애플리케이션의 이미지, 포트, 볼륨, 환경 변수, 네트워크 설정을 YAML 파일에 선언하는 도구다. 길고 반복적인 `docker run` 명령을 Compose 파일로 옮기면 환경 구성을 버전 관리하고 재현하기 쉬워진다.

`docker compose up -d`로 서비스를 한꺼번에 실행하고, `docker compose ps`로 상태를 확인하며, 작업을 마치면 `docker compose down`으로 정리할 수 있다. 또한 같은 Compose 프로젝트의 서비스는 기본 네트워크에서 서비스 이름으로 통신하므로, API와 데이터베이스를 자연스럽게 연결할 수 있다.

개발과 테스트 환경에서는 Compose로 애플리케이션 스택을 간결하게 관리하고, 더 높은 운영 요구가 생기는 환경에서는 Kubernetes 같은 오케스트레이션 도구의 기능을 함께 고려하는 것이 좋다.
