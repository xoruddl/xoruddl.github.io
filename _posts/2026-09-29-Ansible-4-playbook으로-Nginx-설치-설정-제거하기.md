---
layout: post
title: "Ansible (4) - playbook으로 Nginx 설치, 설정, 제거하기"
date: 2026-09-29 09:17:05 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "nginx", "yaml"]
---

## 1. 개요

[이전 글](/posts/Ansible-3-SSH로-실제-서버에-연결하고-ad-hoc-명령-실행하기/)에서는 ad-hoc 명령으로 Nginx를 설치하고 지웠다. 하지만 실제 웹 서버를 준비하려면 설치 뒤에 설정 파일을 넣고, 첫 화면 파일을 바꾸고, 서비스를 재시작하는 단계가 더 필요하다. 이 단계를 매번 명령으로 입력하면 순서를 빠뜨리기 쉽다.

**playbook**은 서버가 가져야 할 상태를 YAML로 적어 둔 설계도다. 이 글에서는 Nginx 설치부터 설정 배포, 제거까지를 playbook으로 만든다.

실습은 이전 글의 `ansible-server` 디렉터리와 설정 파일을 그대로 쓴다. `inventory.ini`의 `[web]` 그룹에는 접속할 서버 `web1`, `web2`가 들어 있고, `ansible.cfg`는 사용할 inventory 파일과 기본 SSH 접속 계정(`ansible`)을 지정한다. 따라서 이 디렉터리에서 명령을 실행하면 접속 대상과 계정을 매번 지정하지 않아도 된다.

---

## 2. 디렉터리 만들고 파일 내려받기

설치 전에 자주 하는 작업이 디렉터리 만들기와 파일 내려받기다. 각각 `file`과 `get_url` 모듈을 쓴다.

```yaml
# download-tomcat.yml
- name: Tomcat 내려받기
  hosts: web        # 그룹 이름
  tasks:
    - name: 디렉터리 만들기
      ansible.builtin.file:
        path: ~/tomcat9           # ~는 접속한 계정(ansible)의 홈 디렉터리
        state: directory
        mode: "0755"

    - name: Tomcat 9 압축 파일 내려받기
      ansible.builtin.get_url:
        url: https://archive.apache.org/dist/tomcat/tomcat-9/v9.0.8/bin/apache-tomcat-9.0.8.tar.gz
        dest: ~/tomcat9/
```

- `file`: `path`의 파일이나 디렉터리를 `state`에 맞게 만든다. `directory`는 디렉터리, `absent`는 삭제, `link`는 심볼릭 링크다.
- `get_url`: `url`의 파일을 관리 노드가 직접 내려받아 `dest`에 저장한다. 이미 같은 파일이 있으면 다시 받지 않는다.

실행하기 전에 `--syntax-check`로 문법만 먼저 검사하면, YAML 들여쓰기나 키 이름이 틀렸을 때 서버에 접속하기 전에 알 수 있다.

```bash
ansible-playbook download-tomcat.yml --syntax-check
ansible-playbook download-tomcat.yml
ansible web -m command -a "ls -l tomcat9"
```

---

## 3. Nginx 설치 playbook

이전 글의 ad-hoc 명령을 playbook으로 옮긴다.

```yaml
# install-nginx.yml
- name: Nginx 설치
  hosts: web
  become: true                  # 이 play의 모든 task를 sudo로 실행
  tasks:
    - name: Nginx 설치
      ansible.builtin.apt:
        name: nginx
        state: present
        update_cache: true
```

`become: true`는 ad-hoc 명령의 `-b`와 같다. play에 적으면 그 안의 모든 task에 적용되고, task에 적으면 그 task에만 적용된다.

설치가 끝나면 서비스 상태와 버전을 확인한다.

```bash
ansible-playbook install-nginx.yml
ansible web -m shell -a "systemctl status nginx | head -3"
ansible web -m command -a "nginx -v"
```

`systemctl status` 결과를 `head`로 자르려면 파이프가 필요하므로 `shell` 모듈을 썼다. `nginx -v`처럼 셸 기능이 필요 없는 명령은 `command`로 충분하다.

---

## 4. 설정과 함께 Nginx 배포하기

### 4.1 파일 준비

Nginx 설정 파일과 첫 화면 파일을 제어 노드의 `ansible-server/files/` 디렉터리에 만든다. `copy` 모듈은 `src`가 상대 경로이면 playbook 옆의 `files/` 디렉터리에서 먼저 찾기 때문이다.

```html
<!-- files/index.html -->
<html>
  <head>
    <title>Welcome To Nginx</title>
  </head>
  <body>
    <h1>nginx configured by ansible</h1>
  </body>
</html>
```

```nginx
# files/nginx.conf
server {
  listen 80 default_server;
  listen [::]:80 default_server ipv6only=on;

  root /usr/share/nginx/html;
  index index.html index.htm;

  server_name localhost;

  location / {
    try_files $uri $uri/ =404;
  }
}
```

이 설정은 80번 포트로 들어온 요청에 `/usr/share/nginx/html` 디렉터리의 파일을 돌려준다. 그래서 `index.html`도 이 디렉터리에 넣는다.

### 4.2 playbook 작성

```yaml
# webservers.yml
- name: Nginx 웹 서버 구성
  hosts: web
  become: true
  tasks:
    - name: Nginx 설치
      ansible.builtin.apt:
        name: nginx
        state: present

    - name: 설정 파일 복사
      ansible.builtin.copy:
        src: nginx.conf
        dest: /etc/nginx/sites-available/default

    - name: 설정 파일 활성화
      ansible.builtin.file:
        src: /etc/nginx/sites-available/default
        dest: /etc/nginx/sites-enabled/default
        state: link

    - name: 첫 화면 파일 복사
      ansible.builtin.copy:
        src: index.html
        dest: /usr/share/nginx/html/index.html

    - name: Nginx 재시작
      ansible.builtin.service:
        name: nginx
        state: restarted
```

Ubuntu의 Nginx는 `sites-available/`에 사이트 설정을 두고, `sites-enabled/`에 그 파일의 심볼릭 링크가 있어야 설정을 읽는다. 세 번째 task가 그 링크를 만든다. 보통 설치할 때 이미 링크가 있어서 `ok`로 끝나지만, 누군가 링크를 지웠다면 다시 만들어 준다.

모듈 인자는 `name=nginx state=restarted`처럼 한 줄에 `키=값`으로 적을 수도 있다. 다만 YAML 형식이 읽기 쉽고 들여쓰기 오류도 잘 드러나서, 이 글에서는 YAML 형식으로 통일한다.

### 4.3 실행과 확인

```bash
ansible-playbook webservers.yml
curl http://192.168.0.11
# <h1>nginx configured by ansible</h1> 이 포함된 HTML
```

기본 Nginx 화면 대신 직접 만든 `index.html`이 나오면 설정 파일과 첫 화면 파일이 모두 적용된 것이다.

### 4.4 재시작을 handler로 바꾸기

위 playbook을 다시 실행하면 다른 task는 모두 `ok`인데, 마지막 재시작 task만 매번 `changed`가 된다. `state: restarted`는 "재시작하라"는 동작이라 실행할 때마다 서비스를 다시 띄우기 때문이다.

[Ansible (2)](/posts/Ansible-2-변수-반복-템플릿-조건-handler로-playbook-다듬기/)에서 본 handler를 쓰면 파일이 바뀌었을 때만 재시작한다. 두 `copy` task에 `notify`를 붙이고, 마지막 task를 바꾼 뒤 handler를 추가한다.

```yaml
    - name: 설정 파일 복사
      ansible.builtin.copy:
        src: nginx.conf
        dest: /etc/nginx/sites-available/default
      notify: Nginx 재시작       # 첫 화면 파일 복사 task에도 같은 줄 추가

    # (설정 파일 활성화, 첫 화면 파일 복사 task 생략)

    - name: Nginx 실행 확인
      ansible.builtin.service:
        name: nginx
        state: started          # 꺼져 있을 때만 켠다
        enabled: true           # 부팅할 때 자동 시작

  handlers:
    - name: Nginx 재시작
      ansible.builtin.service:
        name: nginx
        state: restarted
```

이제 두 번째 실행부터는 `changed=0`이 되고, 설정 파일이나 `index.html`을 고쳤을 때만 재시작한다. 첫 화면 파일은 사실 재시작 없이도 반영되지만, 설정 파일과 같은 흐름을 보여 주려고 함께 연결했다.

---

## 5. Nginx 제거 playbook

설치의 반대 순서로 서비스를 멈추고 패키지를 지운다.

```yaml
# remove-nginx.yml
- name: Nginx 제거
  hosts: web
  become: true
  tasks:
    - name: Nginx 서비스 중지
      ansible.builtin.service:
        name: nginx
        state: stopped
      ignore_errors: true       # Nginx가 없어서 실패해도 다음 task 진행

    - name: Nginx 관련 패키지 삭제
      ansible.builtin.apt:
        name:
          - nginx
          - nginx-common
          - nginx-full
          - nginx-core
        state: absent
        purge: true             # 설정 파일까지 삭제
        autoremove: true        # 쓰지 않는 의존성 패키지도 삭제

    - name: systemd 설정 다시 읽기
      ansible.builtin.systemd_service:
        daemon_reload: true
```

- `ignore_errors: true`: Nginx가 이미 없으면 서비스 중지 task가 실패한다. 이 줄이 없으면 그 서버의 나머지 task를 건너뛰므로, 실패를 무시하고 계속 진행하게 했다.
- `name`에 list를 주면 여러 패키지를 한 번에 처리한다. 설치되지 않은 패키지는 그냥 넘어간다.
- `daemon_reload`: 패키지와 함께 서비스 파일이 지워졌으니 systemd가 서비스 목록을 다시 읽게 한다.

`ansible-playbook remove-nginx.yml`로 실행한 뒤 `ansible web -m shell -a "systemctl status nginx"`를 실행하면, `Unit nginx.service could not be found.` 메시지와 함께 실패로 표시된다. 서비스가 없어졌으니 의도한 결과다.

---

## 6. 정리

playbook은 서버가 가져야 할 상태를 순서대로 적은 YAML 파일이다. `file`로 디렉터리와 링크를, `get_url`로 내려받을 파일을, `apt`로 패키지를, `copy`로 설정 파일을, `service`로 서비스 상태를 적는다. 실행 전에는 `--syntax-check`로 문법을 확인한다.

같은 playbook을 다시 실행해도 이미 맞는 상태면 바꾸지 않는다. 다만 `state: restarted`처럼 매번 동작하는 task는 handler로 옮겨야 파일이 바뀌었을 때만 실행된다. 제거할 때는 `state: absent`와 `ignore_errors`로 이미 없는 상황도 처리할 수 있다.

