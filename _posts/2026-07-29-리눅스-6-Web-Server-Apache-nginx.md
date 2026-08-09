---
layout: post
title: "리눅스 (6) - Web Server (Apache, nginx)"
date: 2026-07-29 17:54:47 +0900
categories: ["리눅스"]
tags: ["Nginx", "apache", "리눅스"]
---

## 리눅스 웹 서버 구축: Apache와 Nginx(리버스 프록시, 로드 밸런싱)

리눅스 환경에서 웹 서비스를 제공하기 위해 가장 널리 사용되는 두 개의 대표적인 웹 서버 프로그램은 Apache와 Nginx이다.

이번 글에서는 Apache와 Nginx의 구조적 차이점을 비교하고, 각각의 설치/설정 방법과 Nginx를 활용한 **정적 파일 게시**, **리버스 프록시(Reverse Proxy)**, **로드 밸런싱(Load Balancing)** 구축 방법을 정리한다.

---

## 1. Apache Web Server

### 📍 개요

* **특징**: 가장 오래되고 검증된 웹 서버로, **프로세스/스레드 기반 구조**를 사용한다.
* **`.htaccess` 지원**: 디렉토리별로 설정을 세밀하게 제어할 수 있어 PHP 기반 웹사이트나 복잡한 모듈 설정이 필요한 환경에 적합하다.
* **확장성**: 수많은 모듈이 존재하며 관련 자료와 생태계가 매우 풍부하다.

### ⚙️ 설치 및 기본 구동

```bash
# Apache2 설치
sudo apt update
sudo apt install -y apache2

# 서비스 상태 확인
sudo systemctl status apache2

# 방화벽(80번 포트) 허용
sudo ufw allow 80

```

> 💡 이미 80번 포트를 다른 서비스(예: Nginx)가 사용 중이라면 해당 서비스를 중지한 후 실행해야 한다.

* **기본 접속**: `http://localhost`
* **기본 웹 루트 디렉토리**: `/var/www/html`
* **메인 설정 파일**: `/etc/apache2/apache2.conf`

### 👤 사용자 계정별 웹 디렉토리 설정 (`userdir` 모듈)

일반 사용자 계정에서 웹사이트를 배포할 수 있도록 `UserDir` 설정을 활성화하는 과정이다.

1. **설정 파일 수정**: `/etc/apache2/mods-available/userdir.conf` 내 `#UserDir disabled root` 주석 처리
2. **모듈 심볼릭 링크 설정 (활성화)**
```bash
sudo ln -s /etc/apache2/mods-available/userdir.conf /etc/apache2/mods-enabled/userdir.conf
sudo ln -s /etc/apache2/mods-available/userdir.load /etc/apache2/mods-enabled/userdir.load

```


3. **서비스 재시작**
```bash
sudo systemctl restart apache2

```


4. **사용자 홈 디렉토리에 `public_html` 생성 및 권한 변경**
```bash
mkdir ~/public_html
chmod 701 ~
chmod 701 ~/public_html

```


5. **테스트용 `index.html` 작성 후 확인**
```bash
curl http://localhost/~<사용자계정명>

```

**전체 동작 과정 요약**
```
1. [클라이언트] curl http://localhost/~eta_kyung 명령어 실행
2. [Apache 웹서버] "~eta_kyung" 요청 감지
3. [UserDir 모듈] "/home/eta_kyung/public_html/" 경로로 변환
4. [권한 검사] www-data 계정이 /home/eta_kyung 및 public_html 진입(x 권한) 가능한지 확인
5. [파일 읽기] public_html 내부의 index.html 읽어서 클라이언트에 응답
```


---

## 2. Nginx

### 📍 개요

* **특징**: 가볍고 빠른 성능을 바탕으로 **대규모 동시 접속자 처리**에 특화된 웹 서버이다.
* **주요 역할**:
* **정적 웹 서버**: 메모리 사용량이 적어 정적 파일 처리에 아파치보다 높은 성능을 보인다.
* **리버스 프록시 (Reverse Proxy)**: 클라이언트와 백엔드 서버 사이에서 중재자 역할을 수행한다. 실제 서버의 IP를 숨길 수 있어 보안이 우수하며, 캐싱을 통해 서버 부하를 줄인다.
* **로드 밸런서 (Load Balancer)**: 여러 대의 백엔드 서버에 트래픽을 분산 처리한다.



### 📊 Apache vs Nginx 비교

| 구분 | Apache | Nginx |
| --- | --- | --- |
| **작동 방식** | 스레드/프로세스 기반 (Multi-Processing) | 비동기 이벤트 기반 (Event-Driven) |
| **성능** | 대규모 동시 접속 시 메모리/스레드 부하 증가 | 대규모 동시 접속 처리에 매우 강함 |
| **유연성** | 디렉토리별 `.htaccess` 및 다양한 모듈 제공 | 가볍고 고성능 처리에 집중 |

---

## 3. Nginx 실전 설정

### ⚙️ 설치 및 기본 확인

```bash
sudo apt install -y nginx
curl http://localhost

```

---

### 1) 정적 웹사이트 게시

특정 도메인 및 경로에 대한 정적 HTML 사이트를 연결하는 설정이다.

1. **디렉토리 생성 및 소유권 설정**
```bash
sudo mkdir -p /var/www/example.com/html
sudo chown -R $USER:$USER /var/www/example.com/html

```


2. **HTML 파일 작성**: `/var/www/[example.com/html/index.html](https://example.com/html/index.html)` 생성
3. **가상 호스트 설정 수정**: `/etc/nginx/sites-available/default`
```nginx
server {
    listen 80;
    listen [::]:80;

    root /var/www/example.com/html;
    index index.html;

    server_name example.com www.example.com;
    # 브라우저에 example.com이나 [www.example.com](https://www.example.com)을 
    # 입력하고 들어온 요청만 이 설정 블록에서 담당하여 처리한다.

    location / {
        try_files $uri $uri/ =404;
    }
}

```


4. **설정 검증 및 적용**
```bash
sudo nginx -t                # 설정 오류 검사
sudo systemctl reload nginx  # 설정 재적용

```



---

### 2) 리버스 프록시 (Reverse Proxy) 설정

외부에서 들어오는 특정 요청(`api.example.com`)을 내부 애플리케이션 서버(`localhost:3000`)로 전달하도록 설정한다.

```nginx
server {
    listen 80;
    server_name api.example.com;
    # api.example.com 도메인으로 들어오는 80번 포트(HTTP) 요청만 이 블록에서 처리하도록 지정

    location / {
        # 내부 애플리케이션 서버로 요청 전달
        proxy_pass http://localhost:3000;

        # 백엔드 서버에 실제 클라이언트 클라이언트 IP/헤더 정보 전달
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

```

* **리버스 프록시 사용 목적**:
* 외부망에 실제 백엔드 서버 IP를 노출하지 않아 **보안 강화** (DDoS, WAF 연동)
* SSL/TLS 암호화 처리 부담(TLS Termination) 이관
* 캐싱 및 압축을 통한 성능 최적화



---

### 3) 로드 밸런싱 (Load Balancing) 설정

`upstream` 블록을 활용하여 여러 대의 백엔드 서버에 트래픽을 라운드로빈 방식으로 분산시킨다.

```nginx
# 1. 백엔드 서버 그룹 정의
upstream backend_servers {
    server 192.168.0.100:8000;
    server 192.168.0.201:8000;
    server 192.168.0.202:8000;
}

server {
    listen 80;
    server_name example.com;

    location / {
        # 2. upstream 그룹으로 프록시 전달
        proxy_pass http://backend_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

```

---

## 4. 마치며

이번 글에서는 리눅스 환경의 대표적인 웹 서버인 Apache와 Nginx의 구조적 차이와 구동 방식을 살펴보았다.

전통적인 대규모 모듈 구성이나 디렉토리별 설정 파일(`.htaccess`)이 필요한 구조에서는 Apache가 여전히 유용하지만, 현대의 MSA(Microservices Architecture) 및 API 게이트웨이 환경에서는 비동기 이벤트 기반 구조의 Nginx를 리버스 프록시 및 로드 밸런서로 구성하는 것이 표준처럼 자리 잡았다. 

상황과 아키텍처에 맞게 두 서버의 특징을 고려하여 적용하는 것이 중요하다.
