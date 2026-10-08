---
layout: post
title: "Ansible (3) - SSH로 실제 서버에 연결하고 ad-hoc 명령 실행하기"
date: 2026-09-29 09:12:06 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "ssh"]
---

## 1. 개요

[이전 글](/posts/Ansible-2-변수-반복-템플릿-조건-handler로-playbook-다듬기/)까지는 내 컴퓨터(`localhost`)만 대상으로 실습했다. Ansible을 실제로 쓰는 곳은 원격 서버이므로, 이번에는 SSH로 서버에 연결하는 과정부터 준비한다.

이 글에서는 관리 노드에 Ansible용 계정을 만들고, SSH 키로 비밀번호 없이 접속하도록 설정한다. 그런 다음 playbook 없이 명령 한 줄(**ad-hoc 명령**)로 파일을 복사하고 Nginx를 설치·삭제해 본다.

---

## 2. 실습 환경

| 역할 | 이름 | 주소 | 준비할 것 |
| --- | --- | --- | --- |
| 제어 노드 | (내 컴퓨터 또는 Ubuntu VM) | - | Ansible, Python |
| 관리 노드 | `web1` | `192.168.0.11` | Ubuntu, SSH 서버, Python |
| 관리 노드 | `web2` | `192.168.0.12` | Ubuntu, SSH 서버, Python |

Ansible 설치는 [Ansible (1)](/posts/Ansible-1-Ansible이-하는-일과-첫-playbook-실행하기/)의 4장을 따른다. 관리 노드에는 Ansible을 설치하지 않는다. Ubuntu 서버에는 보통 Python이 이미 들어 있고, SSH 서버가 동작하는지는 관리 노드에서 확인한다.

```bash
# 관리 노드에서 실행
sudo systemctl status ssh
python3 --version
```

---

## 3. 관리 노드에 Ansible 전용 계정 만들기

Ansible이 접속할 계정을 관리 노드마다 만든다. 여기서는 계정 이름을 `ansible`로 한다. 아래 명령은 **관리 노드(web1, web2)에서** 실행한다.

```bash
sudo adduser ansible
```

`adduser`는 계정을 만들면서 비밀번호도 물어본다. 이 비밀번호는 4장에서 SSH 키를 복사할 때 한 번 쓴다.

패키지 설치처럼 관리자 권한이 필요한 작업을 하려면 이 계정이 `sudo`를 쓸 수 있어야 한다. `/etc/sudoers.d/` 아래에 계정별 파일을 만들어 권한을 준다.

```bash
echo "ansible ALL=(ALL:ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ansible
sudo chmod 440 /etc/sudoers.d/ansible
sudo visudo -c        # sudoers 문법 검사
```

- `ALL=(ALL:ALL)`: 모든 호스트에서, 어떤 사용자·그룹 권한으로든 명령을 실행할 수 있다.
- `NOPASSWD:ALL`: `sudo`를 쓸 때 비밀번호를 묻지 않는다.

`/etc/sudoers` 파일에 쓰기 권한을 준 뒤 직접 고치는 방법도 있지만 권하지 않는다. 문법을 하나만 틀려도 `sudo`가 동작하지 않아 서버를 복구하기 어려워진다. 꼭 고쳐야 한다면 저장할 때 문법을 검사해 주는 `sudo visudo`를 쓴다.

`NOPASSWD`는 실습을 편하게 하려는 설정이다. 실제 운영 서버에서는 sudo 비밀번호를 요구하게 두고, 실행할 때 `-K` 옵션으로 비밀번호를 입력하는 방식도 많이 쓴다.

---

## 4. SSH 키로 비밀번호 없이 접속하기

Ansible은 SSH로 여러 서버에 계속 접속하므로, 매번 비밀번호를 입력하지 않도록 **SSH 키**를 쓴다. 아래 명령은 **제어 노드에서** 실행한다.

```bash
# 키 만들기 (이미 ~/.ssh/id_ed25519 등이 있으면 생략)
ssh-keygen -t ed25519

# 공개 키를 관리 노드에 복사 (이때 3장에서 정한 비밀번호 입력)
ssh-copy-id ansible@192.168.0.11
ssh-copy-id ansible@192.168.0.12
```

`ssh-copy-id`는 제어 노드의 공개 키를 관리 노드의 `~ansible/.ssh/authorized_keys`에 추가한다. 이제 비밀번호 없이 접속되는지 확인한다.

```bash
ssh ansible@192.168.0.11 hostname
# web1
```

---

## 5. inventory와 ansible.cfg

실습 디렉터리를 만들고 inventory를 작성한다.

```bash
mkdir ansible-server
cd ansible-server
```

```ini
# inventory.ini
[web]
web1 ansible_host=192.168.0.11
web2 ansible_host=192.168.0.12
```

`[web]` 그룹에 서버 두 대를 넣었다. 도메인을 쓴다면 `ansible_host` 없이 `web1.example.com`처럼 줄에 바로 적어도 된다.

같은 디렉터리에 `ansible.cfg`를 만든다.

```ini
# ansible.cfg - ansible 의 실행 설정 파일
[defaults]
inventory = ./inventory.ini
remote_user = ansible
```

- `inventory`: 명령마다 `-i inventory.ini`를 붙이지 않아도 된다. 이 설정도 `-i`도 없으면 `/etc/ansible/hosts`를 읽는다.
- `remote_user`: SSH로 접속할 계정이다.

inventory를 확인하고, 모든 서버에 접속되는지 `ping` 모듈로 확인한다.

```bash
ansible-inventory --graph
ansible all -m ping
```

```text
web1 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
web2 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

한 서버라도 `UNREACHABLE`이 나오면 4장의 `ssh ansible@<IP>` 명령으로 SSH 접속부터 다시 확인한다.

---

## 6. ad-hoc 명령의 형식

ad-hoc 명령은 모듈 하나를 명령줄에서 바로 실행한다. 형식은 다음과 같다.

```text
ansible <대상> -m <모듈> -a "<모듈 인자>" [옵션]
```

| 옵션 | 뜻 |
| --- | --- |
| `-i` | inventory 파일 경로 |
| `-m` | 실행할 모듈. 생략하면 `command` 모듈 |
| `-a` | 모듈에 넘길 인자. `이름=값` 형태로 공백으로 구분 |
| `-b` | `become`. 관리자 권한(sudo)으로 실행 |
| `-K` | sudo 비밀번호를 물어본다 |
| `-k` | SSH 비밀번호를 물어본다 (SSH 키 대신 비밀번호로 접속할 때) |
| `--list-hosts` | 실행하지 않고 대상 호스트 목록만 보여 준다 |

실행하기 전에 `ansible web --list-hosts`로 대상이 `web1`, `web2`가 맞는지 확인할 수 있다.

---

## 7. command와 shell 모듈

서버에서 명령을 실행하는 모듈은 두 가지다.

```bash
ansible web -m command -a "uptime"
ansible web -m shell -a "free -h | grep Mem"
```

| 모듈 | 특징 |
| --- | --- |
| `command` | 명령을 셸 없이 바로 실행한다. 파이프(`\|`), 리다이렉션(`>`), 환경 변수(`$HOME`)를 쓸 수 없다 |
| `shell` | `/bin/sh`를 거쳐 실행해서 셸 기능을 모두 쓸 수 있다 |

셸 기능이 필요 없으면 `command`를 쓴다. `shell`은 변수 값이 명령에 그대로 들어가면 의도하지 않은 명령이 실행될 수 있어서(셸 인젝션) 더 조심해야 한다.

두 모듈 모두 명령이 무슨 일을 하는지 모르기 때문에 항상 `CHANGED`로 보고한다. 원하는 상태를 확인해 주는 전용 모듈이 있다면 그 모듈을 쓰는 것이 좋다.

---

## 8. copy 모듈로 파일 보내기

제어 노드의 파일을 관리 노드로 복사한다.

```bash
echo "hello from control node" > test.txt
ansible web -m copy -a "src=./test.txt dest=/tmp/test.txt"
```

```text
web1 | CHANGED => {
    "changed": true,
    "dest": "/tmp/test.txt",
    ...
}
```

같은 명령을 다시 실행하면 이번에는 `SUCCESS`와 `"changed": false`가 나온다. 파일 내용이 같으니 복사하지 않은 것이다. ad-hoc 명령도 playbook과 똑같이 멱등하게 동작한다.

---

## 9. apt 모듈로 Nginx 설치하고 지우기

먼저 어떤 계정으로 명령이 실행되는지 확인한다. `-b`를 붙이면 `sudo`로 실행되어 `root`가 된다.

```bash
ansible web1 -m command -a "whoami"      # ansible
ansible web1 -m command -a "whoami" -b   # root
```

패키지 설치에는 관리자 권한이 필요하므로 `-b`를 붙인다. `apt`는 Ubuntu의 패키지 관리 모듈이다.

```bash
ansible web -m apt -a "name=nginx state=present update_cache=yes" -b
```

- `name=nginx`: 설치할 패키지
- `state=present`: 패키지가 "설치되어 있어야 한다"
- `update_cache=yes`: 설치 전에 `apt update`로 패키지 목록을 갱신한다

3장에서 `NOPASSWD`를 설정하지 않았다면 `-b -K`로 실행하고 sudo 비밀번호를 입력한다. 설치가 끝나면 제어 노드에서 웹 서버가 응답하는지 확인한다.

```bash
curl http://192.168.0.11
# <title>Welcome to nginx!</title> 가 포함된 HTML
```

지울 때는 `state=absent`로 바꾼다.

```bash
ansible web -m apt -a "name=nginx state=absent purge=yes autoremove=yes" -b
```

- `state=absent`: 패키지가 "없어야 한다"
- `purge=yes`: 설정 파일까지 지운다
- `autoremove=yes`: 함께 설치됐다가 더는 쓰지 않는 의존성 패키지도 지운다

어떤 모듈과 인자가 있는지는 `ansible-doc -l`로 목록을, `ansible-doc ansible.builtin.apt`로 설명을 볼 수 있다. 웹에서는 [공식 모듈 색인](https://docs.ansible.com/ansible/latest/collections/index_module.html)에서 찾는다.

---

## 10. 정리

실제 서버를 대상으로 하려면 관리 노드에 Ansible이 접속할 계정을 만들고, 필요한 경우 sudo 권한을 준 뒤, 제어 노드에서 SSH 키를 복사해 비밀번호 없이 접속되게 한다. 접속 정보는 inventory와 `ansible.cfg`에 적고 `ansible all -m ping`으로 확인한다.

ad-hoc 명령은 `ansible <대상> -m <모듈> -a "<인자>"` 형식으로 모듈 하나를 바로 실행한다. `-b`로 관리자 권한을 쓰고, `command`와 `shell`보다 `copy`, `apt`처럼 상태를 확인하는 모듈을 쓰면 여러 번 실행해도 안전하다.

ad-hoc 명령은 한 번 확인하거나 급하게 처리할 때 편하지만, 여러 단계를 매번 똑같이 반복하려면 playbook이 낫다.
