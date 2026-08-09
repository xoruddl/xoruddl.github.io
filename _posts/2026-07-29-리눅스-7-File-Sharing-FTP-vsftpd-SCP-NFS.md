---
layout: post
title: "리눅스 (7) - File Sharing (FTP, vsftpd, SCP, NFS)"
date: 2026-07-29 18:35:16 +0900
categories: ["리눅스"]
tags: ["리눅스"]
---

## File Sharing 개념 및 실습 (FTP, vsftpd, SCP, NFS)

리눅스 환경에서 서버 간 혹은 클라이언트와 파일 데이터를 주고받는 대표적인 기술 4가지(**FTP, vsftpd, SCP/SSH, NFS**)에 대한 개념과 간단한 실습을 정리한다.

---

## 1. FTP (File Transfer Protocol)

### 📌 개요

* **정의**: 네트워크를 통해 컴퓨터 간에 파일을 전송하기 위한 가장 기본적인 표준 통신 규약
* **특징**: 일반적인 프로토콜과 달리 **2개의 포트**를 동시에 활용

### ⚙️ 핵심 작동 원리: 2개 채널

1. **Control Channel (Port 21)**: 사용자 인증(ID/PW) 및 명령어 전달
2. **Data Channel (Port 20)**: 실제 파일 데이터 전송

### 🔄 접속 방식

* **Active Mode (능동 모드)**: 서버가 클라이언트에게 접속을 시도하는 방식
* **Passive Mode (수동 모드)**: 클라이언트가 서버에게 접속을 시도하는 방식 (공유기/방화벽 환경에 유용하며 대부분의 웹 브라우저가 사용)

### 🛡️ 종류 및 보안 방식

* **기본 FTP**: 아이디/비밀번호 및 데이터가 평문으로 전송되어 해킹에 매우 취약
* **SFTP (Secure FTP)**: SSH 기술을 활용해 전송 과정 전체를 암호화 (현재 가장 널리 사용)
* **FTPS (FTP over SSL/TLS)**: SSL/TLS 인증서를 적용하여 전송 구간을 암호화
* **장점**: 대용량 파일 일괄 전송 시 속도가 매우 빠르고 효율적
* **단점**: 암호화 미설정 시 정보 유출 위험, 설정 및 방화벽 예외 처리가 까다로울 수 있음

---

## 2. vsftpd (Very Secure FTP Daemon)

### 📌 개요

* 우분투(Ubuntu) 등 리눅스에서 기본 제공되는 보안성과 성능이 우수한 FTP 서버 소프트웨어
* 설치 및 운영 관리가 간편함 (※ 최근에는 보안 이슈로 실무에서 단독 FTP는 잘 사용하지 않는 추세)

### 🛠️ 설치 및 설정

```bash
# 설치
sudo apt -y install vsftpd

# 설정 파일: /etc/vsftpd.conf

```

#### 주요 설정 항목 (`/etc/vsftpd.conf`)

* `anonymous_enable`: 익명 사용자 접속 허용 여부
* `local_enable`: 로컬 계정 사용자 접속 허용 여부
* `max_clients`: 동시 최대 접속자 수
* `max_per_ip`: IP당 최대 접속자 수

### 💻 실습 과정

```bash
# 1. 설정 변경 (익명 업로드 및 쓰기 권한 허용 예시)
# /etc/vsftpd.conf 수정
# anonymous_enable=YES
# write_enable=YES
# anon_upload_enable=YES
# anon_mkdir_write_enable=YES

# 2. 디렉토리 생성 및 권한 설정
cd /srv/ftp
sudo mkdir pub
sudo chmod 777 pub
cd pub
touch file
ls -l

# 3. 서비스 재시작
sudo systemctl restart vsftpd

```

---

## 3. SSH를 이용한 파일 전송 (SCP)

> **💡 핵심**: 실무에서 파일 전송 작업 시 가장 빈번하게 사용되므로 반드시 숙지해야 하는 방식

### 📌 사용하는 이유

* 별도의 FTP 서버 프로그램 설치 불필요
* SSH 기반으로 전송 과정 데이터 무결성 및 암호화 보장
* 다양한 인증 방식(비밀번호, Key pair) 지원

### 🚀 SCP (Secure Copy) 기본 사용법

`SCP`는 명령어 한 줄로 간단하고 빠르게 파일/디렉토리를 복사할 수 있는 도구입니다. (SSH 서비스 동작 필요)

* **로컬 ➔ 원격지 파일 전송**
```bash
scp [파일경로] [계정]@[IP주소]:[저장경로]
# 예시
scp at.dat etakyung@server:/home/etakyung/ftp

```


* **원격지 ➔ 로컬 파일 전송 (로컬에서 실행)**
```bash
scp [계정]@[IP주소]:[원격파일경로] [로컬저장경로]
# 예시
scp etakyung@server:/home/etakyung/etakyung.pem /home/etakyung

```



### 🔑 Key File (`.pem`)을 이용한 인증 전송

```bash
# 1. PEM 키 생성
ssh-keygen -t rsa -b 4096 -m PEM -f 파일경로

# 2. 키 파일 보안 권한 변경 (소유자 읽기 전용)
chmod 400 파일경로

# 3-1. PEM 키를 이용한 로컬 -> 원격지 전송
scp -i pem파일경로 [파일경로] [계정]@[IP주소]:[저장경로]

# 3-2. PEM 키를 이용한 원격지 -> 로컬 전송
scp -i pem파일경로 [계정]@[IP주소]:[파일경로] [로컬경로]

```

---

## 4. NFS (Network File System)

### 📌 개요

* 네트워크상의 다른 컴퓨터 파일 시스템을 마치 **자신의 로컬 디스크처럼 마운트하여 사용할 수 있게 해주는 C/S 프로토콜**
* 유닉스/리눅스 환경의 표준 네트워크 파일 공유 규약

### ✨ 주요 특징

* **Transparency (투명성)**: 사용자는 파일이 원격에 있는지 로컬에 있는지 구분 없이 동일한 파일 시스템 명령어로 접근 가능
* **중앙 집중 관리**: 서버 한 곳에서 데이터를 통합 관리하므로 백업 및 보안 관리 용이
* **플랫폼 독립성**: RPC(Remote Procedure Call) 매커니즘을 사용하여 다른 OS 간에도 파일 공유 가능

### ⚖️ 장단점

* **장점**: 비용 절감, 사용자 홈 디렉토리 공통화로 동일한 작업 환경 제공
* **단점**: 네트워크 장애 시 영향도가 크며, 구버전의 경우 호스트 IP 기반 인증으로 인해 보안에 주의 필요

### 🎯 주요 활용 사례

* **클러스터 서버**: 여러 대의 Web / WAS 서버가 동일한 정적 파일 디렉토리를 공유할 때
* **중앙 백업**: 여러 서버의 데이터를 하나의 스토리지 서버로 모을 때
* **Kubernetes (k8s)**: 컨테이너의 휘발성 데이터를 보존하기 위한 **영구 볼륨(Persistent Volume)** 연동

---

## 5. NFS 구축 실습

### 🔄 전체 구현 흐름

1. **NFS 서버**: 패키지 설치 ➔ `/etc/exports` 공유 경로/권한 설정 ➔ 서비스 시작
2. **NFS 클라이언트**: 패키지 설치 ➔ `showmount`로 공유 확인 ➔ `mount` 명령어로 로컬 디렉토리에 마운트

---

### 🖥️ NFS Server 설정

```bash
# 1. 패키지 업데이트 및 설치
sudo apt update
sudo apt install nfs-kernel-server

# 2. 공유 디렉토리 생성 및 권한 부여
sudo mkdir -p /share && sudo chmod 777 /share
sudo touch /share/file

# 3. /etc/exports 파일 수정 (공유 대상 및 권한 설정)
sudo vim /etc/exports
# 예시 내용 추가: /share 192.168.64.0/24(rw,sync,no_subtree_check)

# 4. 설정 반영 및 방화벽 설정
sudo exportfs -rav
sudo ufw allow from 192.168.64.0/24

# 5. 서비스 활성화 및 재시작
sudo systemctl enable nfs-server
sudo systemctl restart nfs-server
sudo systemctl status nfs-server

```

### 💻 NFS Client 설정

```bash
# 1. 패키지 설치
sudo apt install nfs-common

# 2. 서버 공유 디렉토리 확인
showmount -e 192.168.64.16

# [출력 예시]
# Export list for 192.168.64.16:
# /share 192.168.64.0/24

# 3. 마운트할 디렉토리 생성 및 NFS 마운트
mkdir ~/myshare
sudo mount -t nfs -o nfsvers=3 192.168.64.16:/share ~/myshare

```
