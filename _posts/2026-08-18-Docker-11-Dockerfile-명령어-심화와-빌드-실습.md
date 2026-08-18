---
layout: post
title: "Docker (11) - Dockerfile 명령어 심화와 빌드 실습"
date: 2026-08-18 18:51:12 +0900
categories: ["Docker"]
tags: ["docker", "dockerfile", "iac", "도커"]
---

## 1. 개요
[Docker (4)](https://xoruddl.github.io/posts/Docker-4-/)에서 FROM, WORKDIR, COPY, RUN, ENV, EXPOSE, CMD로 이어지는 Dockerfile의 기본 골격과 멀티 스테이지 빌드를 다뤘다. 이번 글에서는 그때 다루지 않았던 나머지 명령어들(ENTRYPOINT, ADD, VOLUME, USER, ARG, ONBUILD, HEALTHCHECK 등)을 정리하고, `docker build` 옵션과 실제 이미지를 빌드해서 컨테이너로 띄우는 과정까지 실습으로 이어본다.

그전에 왜 Dockerfile 같은 방식(IaC)이 필요한지부터 짚고 넘어간다.

---

## 2. IaC(Infrastructure as Code)가 필요한 이유
서버에 CLI 명령을 하나씩 입력해서 인프라를 구성하면 사람의 실수가 끼어들 여지가 많다. 예를 들어 Apache + PHP + MySQL(APM) 조합을 구성한다고 하면 설치 순서와 프로그램 간의 의존 관계까지 고려해서 명령어를 순서대로 정확히 입력해야 한다. 워드프레스 같은 경우는 MySQL이나 MariaDB가 먼저 떠 있지 않으면 설치 자체가 진행되지 않는 식으로, 순서를 지키지 않으면 바로 실패한다.

설정을 다 마친 뒤에 잘못된 부분이 발견되면 그 부분만 수정하면 되지만, 수동으로 쌓아 올린 환경에서는 원인 파악이 쉽지 않아 처음부터 재설치해야 하는 경우도 생긴다. 이런 문제를 코드로 인프라 구성 과정 자체를 기록해서 해결하려는 접근이 **IaC**이고, 도커에서는 **Dockerfile**이 그 역할을 한다. Dockerfile은 이미지를 어떻게 만들었는지를 그대로 기록으로 남기기 때문에 배포가 쉬워지고, 컨테이너가 생성되는 시점에 특정 동작을 수행하도록 지정할 수도 있다.

---

## 3. 아직 다루지 않은 Dockerfile 명령어

### MAINTAINER / LABEL
**MAINTAINER**는 이미지를 만든 작성자 이름과 이메일을 기록하던 명령어다.

```
MAINTAINER adam.park itstudy@kakao.com
```

지금은 사용이 권장되지 않고, 대신 **LABEL**로 버전·설명·라이선스 같은 메타데이터를 key-value 형태로 여러 줄 기록하는 방식을 쓴다.

```
LABEL version="1.0"
LABEL description="web service"
```

### ENTRYPOINT와 CMD의 관계
CMD는 컨테이너 실행 시점에 실행할 명령을 지정하지만, `docker run` 뒤에 명령어를 덧붙이면 CMD 전체가 그 명령으로 통째로 교체된다. **ENTRYPOINT**를 쓰면 이 관계가 달라진다. ENTRYPOINT는 항상 실행되어야 하는 고정된 실행 파일을 지정하고, CMD는 거기에 기본으로 넘어갈 인자 역할만 한다.

```
ENTRYPOINT ["python"]
CMD ["runapp.py"]
```

이미지를 그냥 실행하면 `python runapp.py`가 되고, `docker run 이미지이름 other.py`처럼 뒤에 인자를 붙이면 CMD("runapp.py")만 "other.py"로 바뀌어 `python other.py`가 실행된다. 즉 ENTRYPOINT는 고정 실행 파일, CMD는 런타임에 바뀔 수 있는 기본 인자라고 이해하면 된다.

entrypoint.sh 스크립트를 실행하는 패턴도 자주 쓰인다.

```
ADD ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
```

> `docker stop`은 컨테이너를 강제로 죽이는 게 아니라, 컨테이너 안의 **PID 1 프로세스**에게 SIGTERM 신호를 보내서 "정리하고 알아서 종료해라"라고 요청하는 방식이다. 여기서 PID 1은 컨테이너 안에서 가장 먼저 실행된 프로세스를 가리키고, 이 신호는 오직 PID 1에게만 전달된다.
>
> exec 형식(`ENTRYPOINT ["python", "app.py"]`)으로 배열로 작성하면 `python` 프로세스가 그대로 PID 1이 되기 때문에 SIGTERM을 직접 받아서 바로 반응할 수 있다. 반면 shell 형식(`ENTRYPOINT python app.py`)으로 문자열만 써주면, 도커가 이 명령을 내부적으로 `/bin/sh -c "python app.py"`로 바꿔서 실행한다. 이 경우 PID 1은 `sh`가 되고 실제 실행 파일인 `python`은 그 자식 프로세스로 밀려나는데, SIGTERM은 PID 1인 `sh`에게만 전달되므로 `sh`가 이를 자식 프로세스에게 제대로 넘겨준다는 보장이 없다. 그래서 `python`이 신호를 받지 못한 채 도커가 정한 타임아웃(기본 10초)까지 기다렸다가 강제 종료(SIGKILL)되는 경우가 생길 수 있다.
>
> 이런 이유로 실제 실행 파일이 PID 1로 직접 뜨는 exec 형식이 권장된다.

`docker run --entrypoint 새명령 이미지이름`으로 이미지에 정의된 ENTRYPOINT를 실행 시점에 덮어쓸 수도 있다. CMD와 마찬가지로 ENTRYPOINT도 여러 번 작성하면 마지막 한 줄만 적용된다.

### ADD와 COPY의 차이
COPY는 호스트의 파일을 이미지 안으로 복사만 하고, 빌드 컨텍스트(Dockerfile이 있는 디렉토리) 바깥의 파일은 다룰 수 없다. **ADD**는 여기에 두 가지 기능이 더 있다. URL을 지정하면 그 주소에서 파일을 직접 다운로드해서 넣을 수 있고, 압축 파일을 지정하면 자동으로 압축을 풀어서 추가해준다.

```
ADD index.html /usr/share/nginx/html
ADD https://example.com/file.tar.gz /workspace/data/
```

단순히 파일만 복사한다면 동작이 명확한 COPY를 쓰고, 다운로드나 압축 해제가 필요할 때만 ADD를 쓰는 편이 의도를 파악하기 쉽다.

### VOLUME
컨테이너에서 사용할 볼륨을 이미지 빌드 시점에 미리 지정해두는 명령어다. VOLUME으로 지정한 경로는 도커의 볼륨 기본 경로(`/var/lib/docker`) 아래에 자동으로 연결된다. 볼륨의 개념과 마운트 방식은 [Docker (8)](https://xoruddl.github.io/posts/Docker-8-볼륨/)에서 다룬 내용과 이어진다.

```
VOLUME /var/log
VOLUME /var/www/html
```

### USER
컨테이너의 기본 사용자는 `root`다. 애플리케이션이 굳이 root 권한 없이 동작할 수 있다면, **USER**로 실행 사용자를 바꿔서 불필요한 권한을 갖지 않도록 하는 게 안전하다.

```
RUN ["useradd", "adam"]
USER adam
RUN ["/bin/bash", "-c", "date"]
```

### ARG
**ARG**는 `docker build --build-arg`로 값을 전달받아 빌드 과정에서만 쓰는 변수다. 계정 비밀번호나 비밀 키처럼 민감한 값을 Dockerfile에 직접 적어두면 이미지에 그대로 남아 노출될 수 있기 때문에, 이런 값은 빌드 시점에 외부에서 주입하는 용도로 쓴다.

`ARG`는 값을 직접 갖고 있는 게 아니라, "이런 이름의 변수를 받을 수 있다"는 선언만 Dockerfile 안에 해두는 것이다. 실제 값은 이미지를 빌드할 때 터미널에서 넘겨준다.

```dockerfile
# Dockerfile
ARG db_name
```

```bash
# 터미널에서 빌드할 때 값을 전달
docker build --build-arg db_name=itstudy .
```

> ARG는 빌드가 끝나는 순간 사라지기 때문에 CMD나 ENTRYPOINT 같은 컨테이너 실행 시점에는 값을 쓸 수 없다. 실행 중에도 값이 필요하면 ENV로 한 번 옮겨 담아야 한다.
>
> ```
> ARG db_name
> ENV DB_NAME=$db_name
> CMD db_start.sh -h 127.0.0.1 -d $DB_NAME
> ```

### ONBUILD, STOPSIGNAL, SHELL
- **ONBUILD**: 지금 빌드하는 이미지에는 바로 적용되지 않고, 이 이미지를 베이스 이미지로 삼아 다른 이미지를 빌드할 때 실행될 명령을 미리 지정해둔다.
- **STOPSIGNAL**: `docker stop`은 기본적으로 SIGTERM을 컨테이너에 보낸다. 다른 시그널을 쓰고 싶으면 `STOPSIGNAL SIGKILL`처럼 시그널 이름이나 번호를 지정한다.
- **SHELL**: Dockerfile 내부에서 shell 형식 명령을 실행할 때 사용할 기본 셸을 바꾼다. 예를 들어 `SHELL ["/bin/bash", "-c"]`.

### HEALTHCHECK
컨테이너 내부 프로세스가 정상적으로 동작하는지 주기적으로 확인하는 명령어다. 여러 번 작성해도 마지막 하나만 적용된다.

| 옵션 | 의미 | 기본값 |
| --- | --- | --- |
| `--interval=초` | 헬스 체크 간격 | 30s |
| `--timeout=초` | 체크 명령의 타임아웃 | 30s |
| `--retries=숫자` | 연속 실패로 unhealthy 판정하기까지의 횟수 | 3 |

상태 코드는 0이면 정상, 1이면 unhealthy, 2는 starting을 위해 예약된 값이다.

```
HEALTHCHECK --interval=1m --timeout=3s --retries=5 CMD curl -f http://localhost || exit 1
```

위 설정은 1분마다 `curl`로 헬스 체크를 하는데, 응답에 3초 넘게 걸리면 한 번 실패로 세고, 5번 연속 실패하면 컨테이너를 unhealthy로 표시한다.

---

## 4. 이미지 빌드 명령
Dockerfile을 이미지로 만드는 명령은 다음과 같다.

```
docker build [옵션] 이미지이름[:태그] Dockerfile_경로 | URL | 압축파일
```

자주 쓰는 옵션은 두 가지다.

| 옵션 | 의미 |
| --- | --- |
| `-t` | 이미지 이름과 태그 지정 |
| `-f` | Dockerfile이 아닌 다른 이름의 파일을 사용할 때 파일명 지정 |

경로는 보통 현재 디렉토리(`.`)를 지정하며, 하나의 디렉토리에는 Dockerfile 하나만 두는 구성을 권장한다. GitHub 같은 원격 저장소의 URL을 그대로 지정할 수도 있다.

```
docker build -t phpserver:2.0 github.com/brayanlee/docker-phpserver
```

> Dockerfile은 FROM부터 시작하고 그 뒤 순서는 자유지만, 명령 순서가 빌드 캐시 무효화에 영향을 준다. 변경이 잦은 명령(소스 코드 COPY 등)은 뒤쪽에, 변경이 드문 명령(패키지 설치 등)은 앞쪽에 두는 편이 캐시를 최대한 활용할 수 있다. 그리고 처음부터 OS 이미지로 모든 걸 직접 설치하기보다, 원하는 애플리케이션이 이미 설치된 공식 이미지를 베이스로 쓰는 편이 유지보수 측면에서 유리하다.

---

## 5. 실습 - nginx 이미지로 메인 페이지 바꾸기
nginx 베이스 이미지 위에 직접 만든 index.html을 얹어서, "메인 페이지가 바뀐 nginx 이미지"를 빌드해본다. 흐름은 작업 디렉토리 준비 → index.html 작성 → Dockerfile 작성 → 이미지 빌드 → 컨테이너 실행 순이다.

**① 작업 디렉토리를 만들고 index.html 작성**

```
mkdir mynginx && cd mynginx
```

```html
<html>
    <head>
        <title>Docker Image Build</title>
    </head>
    <body>
        <h1>nginx Web Server</h1>
    </body>
</html>
```

**② 같은 디렉토리에 Dockerfile 작성**

nginx 이미지는 기본적으로 `/usr/share/nginx/html` 경로에 있는 파일을 메인 페이지로 보여준다. 그래서 방금 만든 index.html을 이 경로로 COPY해주면 된다.

```dockerfile
FROM nginx
COPY index.html /usr/share/nginx/html
```

**③ 이미지 빌드**

```
docker build -t mynginx .
```

**④ 이미지가 만들어졌는지 확인**

```
docker images
```

**⑤ 이미지로 컨테이너 생성**

```
docker run --name mynginx -d -p 8001:80 mynginx
```

**⑥ 컨테이너 생성 여부와 포트 확인**

```
docker ps
curl localhost:8001
```

`docker ps`로 mynginx 컨테이너가 떠 있는지, 8001번 포트가 열려 있는지 확인하고, 브라우저나 `curl`로 접속해서 방금 작성한 "nginx Web Server" 문구가 뜨는지 확인하면 된다.

---

## 6. Dockerfile을 쓰는 이유
같은 결과물을 수동으로 만든다고 생각하면 이 차이가 더 분명해진다. 우분투에 Apache와 PHP를 직접 설치해서 페이지를 띄우려면 아래처럼 패키지 설치, 서비스 실행, 파일 수정을 순서대로 진행해야 한다.

```bash
sudo apt update
sudo apt install -y apache2
sudo service apache2 start
sudo service apache2 status
curl localhost:80

sudo mv /var/www/html/index.html /var/www/html/index.html.org
sudo apt install vim
sudo vim /var/www/html/index.html
curl localhost:80

sudo apt -y install php
sudo vim /var/www/html/index.php
sudo service apache2 restart
```

이 방식은 호스트 운영체제를 직접 설정해가며 환경을 구성하기 때문에, 인프라 규모가 커질수록 관리 부담도 함께 커진다. 게다가 동일한 환경을 다시 만들려면 위 명령을 처음부터 그대로 다시 입력해야 한다. 예전에는 이런 명령을 텍스트 파일이나 스크립트 파일로 남겨두고 재실행하는 식으로 대응했지만, 이는 결국 Dockerfile이 이미지 레벨에서 표준화해서 해주는 일을 사람이 직접 수기로 관리하는 것과 같다. Dockerfile로 같은 과정을 기록해두면 `docker build` 한 번으로 동일한 환경을 몇 번이든 재현할 수 있다는 점이 근본적인 차이다.

---

## 7. 정리
이번 글에서는 [Docker (4)](https://xoruddl.github.io/posts/Docker-4-/)에서 다루지 못한 Dockerfile 명령어들을 마저 정리했다. ENTRYPOINT는 CMD와 짝을 이뤄 고정 실행 파일과 가변 인자를 분리하고, ADD는 COPY에 다운로드·압축 해제 기능이 더해진 명령이며, VOLUME·USER·ARG·HEALTHCHECK는 각각 데이터 영속성, 실행 권한, 빌드 시점 변수, 컨테이너 상태 체크를 담당한다는 점을 확인했다.

또한 `docker build`로 이미지를 빌드해서 실제 웹 서버 컨테이너를 띄워보고, 같은 결과를 수동으로 구성했을 때와 비교해봤다. 결국 Dockerfile의 핵심은 인프라 구성 과정을 코드로 남겨서 언제든 동일하게 재현할 수 있게 만드는 것이며, 이것이 IaC가 해결하고자 하는 문제와 정확히 맞닿아 있다.
