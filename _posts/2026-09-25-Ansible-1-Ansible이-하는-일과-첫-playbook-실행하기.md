---
layout: post
title: "Ansible (1) - Ansible이 하는 일과 첫 playbook 실행하기"
date: 2026-09-25 14:14:37 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "yaml"]
---

## 1. 개요

서버 10대에 같은 패키지를 설치하고 같은 설정 파일을 넣어야 한다고 해 보자. 한 대씩 SSH로 접속해 명령을 입력하면 시간이 오래 걸리고, 중간에 한 대를 빠뜨리거나 명령을 잘못 입력하기 쉽다.

**Ansible**은 이런 작업을 **playbook**이라는 파일에 적어 두면, 여러 서버에 접속해 그 내용대로 실행해 주는 자동화 도구다.

이 글에서는 Ansible이 어떻게 동작하는지 알아보고, 서버 없이 내 컴퓨터(`localhost`)를 대상으로 첫 playbook을 실행해 본다.

---

## 2. Ansible이 동작하는 방식

Ansible을 실행하는 컴퓨터를 **제어 노드**(control node), 작업을 받는 서버를 **관리 노드**(managed node)라고 한다.

```text
제어 노드 (내 컴퓨터, Ansible 설치)
   │  SSH로 접속해서 작업 실행
   ├──> 서버 1
   ├──> 서버 2
   └──> 서버 3   (Ansible 설치 필요 없음. SSH와 Python만 있으면 됨)
```

관리 노드에는 Ansible을 설치하지 않는다. 별도 프로그램(에이전트) 없이 SSH로 접속해 작업을 실행하는 방식이라 **에이전트리스**(agentless)라고 부른다. 대부분의 리눅스 서버에는 SSH와 Python이 이미 있어서 바로 쓸 수 있다.

Ansible의 또 다른 특징은 **멱등성**(idempotency)이다. 멱등성은 같은 작업을 여러 번 실행해도 결과가 같은 성질이다. Ansible 작업은 대부분 "파일이 이 내용으로 있어야 한다"처럼 원하는 상태를 적는 방식이다. 그래서 이미 그 상태면 아무것도 하지 않고, 다를 때만 바꾼다. 7장에서 직접 확인한다.

같은 IaC 도구인 [Terraform](/posts/Terraform-1-Terraform이-하는-일과-첫-리소스-만들기/)과는 맡는 일이 다르다. 둘은 경쟁하기보다 함께 쓰는 경우가 많다.

| | Terraform | Ansible |
| --- | --- | --- |
| 주로 하는 일 | 서버, 네트워크, 디스크 같은 인프라를 **만든다** | 만들어진 서버 **안에** 패키지를 설치하고 설정한다 |
| 작성 방식 | 최종 상태를 선언 | 작업(task)을 위에서 아래로 순서대로 나열 |
| 상태 기록 | state 파일에 기록 | 기록하지 않음. 실행할 때마다 서버의 현재 상태를 직접 확인 |

---

## 3. 핵심 용어

| 용어 | 뜻 |
| --- | --- |
| **inventory** | 작업할 서버 목록. 서버들을 그룹으로 묶어 둔다 |
| **module** | "파일 복사", "패키지 설치"처럼 미리 만들어진 작업 단위 |
| **task** | 모듈 하나를 한 번 실행하는 단위 ("설정 파일 복사") |
| **play** | "어떤 서버 그룹에" + "어떤 task들을" 실행할지 묶은 것 |
| **playbook** | play들을 적어 둔 YAML 파일 |

playbook을 실행하면 play마다 inventory에서 대상 서버를 고르고, task를 위에서 아래로 하나씩 실행한다. 각 task는 대상 서버마다 실행된다.

이때 한 task를 모든 대상 서버에서 **병렬로** 실행하고, 모든 서버에서 그 task가 끝나야 다음 task로 넘어간다. 또 서버가 작업을 가져가는 방식이 아니라 제어 노드가 서버로 작업을 보내는 **push 방식**이라, 원하는 시점에 바로 실행할 수 있다.

---

## 4. 설치

macOS에서는 Homebrew로 설치한다.

```bash
brew install ansible
```

Ubuntu에서는 Ansible 공식 PPA 저장소를 추가한 뒤 `apt`로 설치한다.

```bash
sudo apt update
sudo add-apt-repository --yes --update ppa:ansible/ansible
sudo apt install -y ansible
```

Python 도구로 설치해도 된다. 다른 운영체제는 [공식 설치 문서](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)를 따른다.

```bash
pipx install --include-deps ansible
```

설치가 끝나면 버전을 확인한다.

```bash
ansible --version
# ansible [core 2.21.4]
```

---

## 5. inventory 만들기

실습 디렉터리를 만든다.

```bash
mkdir ansible-practice
cd ansible-practice
```

먼저 작업 대상 목록인 inventory를 만든다. 이 글에서는 서버 대신 내 컴퓨터를 대상으로 한다.

```ini
# inventory.ini
[local]
localhost ansible_connection=local ansible_python_interpreter=auto_silent
```

- `[local]`: 그룹 이름이다. 대괄호 아래 줄들이 이 그룹에 속한다.
- `localhost`: 호스트 이름이다.
- `ansible_connection=local`: SSH로 접속하지 않고 내 컴퓨터에서 바로 실행한다.
- `ansible_python_interpreter=auto_silent`: 작업을 실행할 Python을 자동으로 찾고, 그에 관한 경고 메시지를 숨긴다.

같은 디렉터리에 `ansible.cfg`를 만들어 이 inventory를 기본값으로 지정한다. 이 파일이 없으면 명령마다 `-i inventory.ini`를 붙여야 한다.

```ini
# ansible.cfg
[defaults]
inventory = inventory.ini
```

inventory가 제대로 읽히는지 그룹 구조를 출력해 본다.

```bash
ansible-inventory --graph
```

```text
@all:
  |--@ungrouped:
  |--@local:
  |  |--localhost
```

`all`은 적지 않아도 자동으로 있는 그룹으로, 모든 호스트를 포함한다.

---

## 6. 명령 하나 실행해 보기

playbook을 쓰기 전에, 모듈 하나를 명령줄에서 바로 실행할 수 있다. 이것을 **ad-hoc 명령**이라고 한다. `ping` 모듈로 접속이 되는지 확인한다.

```bash
ansible all -m ping
```

```text
localhost | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

- `all`: 대상 그룹
- `-m ping`: 실행할 모듈

`ping` 모듈은 네트워크 ping이 아니라, "Ansible이 접속해서 Python으로 작업을 실행할 수 있는지"를 확인한다. `pong`이 오면 준비가 끝난 것이다. 출력에 `ansible_facts` 같은 줄이 더 보일 수 있는데, 무시해도 된다.

---

## 7. 첫 playbook

### 7.1 작성

`hello.yml` 파일을 만든다. playbook은 **YAML** 형식으로 쓴다. YAML은 들여쓰기로 구조를 나타내는 형식이고, 탭 대신 공백만 쓴다.

```yaml
# hello.yml
- name: 첫 번째 playbook              # play 이름 (실행 화면에 표시)
  hosts: local                        # 대상: inventory의 local 그룹
  tasks:                              # 실행할 task 목록. 위에서 아래로 실행
    - name: 작업 디렉터리 만들기       # task 이름
      ansible.builtin.file:           # 사용할 모듈
        path: /tmp/ansible-practice   # 모듈 인자: 디렉터리 경로
        state: directory              # 디렉터리가 "있어야 한다"
        mode: "0755"                  # 권한

    - name: 인사 파일 쓰기
      ansible.builtin.copy:           # 파일을 만들거나 복사하는 모듈
        dest: /tmp/ansible-practice/hello.txt   # 만들 파일
        content: "Hello, Ansible!\n"            # 파일 내용
        mode: "0644"
```

YAML에서 `-`로 시작하는 줄은 list의 원소다. 이 playbook은 play 1개로 되어 있고, 그 play 안에 task 2개가 있다.

`ansible.builtin.file`처럼 점으로 이어진 모듈 이름은 `컬렉션.모듈` 구조다. `ansible.builtin`은 Ansible에 기본으로 들어 있는 모듈 모음이다. 모듈마다 쓸 수 있는 인자는 `ansible-doc ansible.builtin.copy`처럼 확인한다.

`mode`의 `"0755"`를 따옴표로 감싼 이유는 따옴표가 없으면 YAML이 숫자로 읽을 수 있기 때문이다. 파일 권한은 항상 따옴표로 감싼다.

### 7.2 실행

`ansible-playbook`으로 실행한다.

```bash
ansible-playbook hello.yml
```

```text
PLAY [첫 번째 playbook] ********************************************************

TASK [Gathering Facts] *********************************************************
ok: [localhost]

TASK [작업 디렉터리 만들기] ****************************************************
changed: [localhost]

TASK [인사 파일 쓰기] **********************************************************
changed: [localhost]

PLAY RECAP *********************************************************************
localhost                  : ok=3    changed=2    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
```

- `Gathering Facts`: task를 실행하기 전에 대상의 운영체제, IP 같은 정보(**facts**)를 모으는 단계다. 적지 않아도 play마다 자동으로 실행된다.
- `changed`: 이 task가 실제로 무언가를 바꿨다는 뜻이다. 디렉터리와 파일이 새로 만들어졌다.
- `PLAY RECAP`: 호스트별 요약이다. `ok`는 성공한 task 수이고, `changed`인 task도 여기에 포함된다.

task 결과는 주로 다음 네 가지로 나온다.

| 결과 | 뜻 |
| --- | --- |
| `ok` | 이미 원하는 상태라 바꾸지 않고 끝났다 |
| `changed` | 원하는 상태로 만들기 위해 무언가 바꿨다 |
| `failed` | task가 실패했다. 그 호스트의 나머지 task는 실행하지 않는다 |
| `unreachable` | 호스트에 접속하지 못했다 (SSH 문제 등) |

```bash
cat /tmp/ansible-practice/hello.txt
# Hello, Ansible!
```

### 7.3 다시 실행하기

같은 playbook을 한 번 더 실행한다.

```bash
ansible-playbook hello.yml
```

```text
TASK [작업 디렉터리 만들기] ****************************************************
ok: [localhost]

TASK [인사 파일 쓰기] **********************************************************
ok: [localhost]

PLAY RECAP *********************************************************************
localhost                  : ok=3    changed=0    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
```

이번에는 모두 `ok`이고 `changed=0`이다. 디렉터리와 파일이 이미 원하는 상태라서 아무것도 바꾸지 않았다. 2장에서 말한 멱등성이다.

### 7.4 누군가 파일을 바꿨다면

파일을 손으로 고친 뒤 다시 실행해 본다. `--diff`를 붙이면 무엇이 바뀌는지 보여 준다.

```bash
echo "changed by hand" > /tmp/ansible-practice/hello.txt
ansible-playbook hello.yml --diff
```

```text
TASK [인사 파일 쓰기] **********************************************************
@@ -1 +1 @@
-changed by hand
+Hello, Ansible!

changed: [localhost]

PLAY RECAP *********************************************************************
localhost                  : ok=3    changed=1    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
```

파일 내용이 playbook과 다르니 원래대로 되돌렸다. playbook이 "무엇을 실행할지"보다 "어떤 상태여야 하는지"를 적고 있기 때문에, 서버 설정이 누군가의 손으로 달라져도 playbook을 다시 실행하면 원래대로 맞춰진다.

---

## 8. 실제 서버를 대상으로 할 때

실제 서버에서 쓰려면 inventory에 서버 주소와 접속 계정을 적는다. 예를 들면 다음과 같다.

```ini
[web]
web1 ansible_host=192.168.0.11 ansible_user=ubuntu
web2 ansible_host=192.168.0.12 ansible_user=ubuntu
```

- `ansible_host`: 실제로 SSH로 접속할 주소다. `web1`은 Ansible 안에서 부르는 이름이다.
- `ansible_user`: SSH 접속 계정이다.

제어 노드에서 이 서버들에 SSH 키로 비밀번호 없이 접속할 수 있어야 한다. 패키지 설치처럼 관리자 권한이 필요한 작업은 play에 `become: true`를 적으면 `sudo`로 실행된다.

playbook은 `hosts: web`으로 바꾸기만 하면 된다. 대상이 1대든 100대든 같은 playbook을 쓴다. 서버 준비부터 SSH 키 설정까지는 [Ansible (3)](/posts/Ansible-3-SSH로-실제-서버에-연결하고-ad-hoc-명령-실행하기/)에서 자세히 다룬다.

---

## 9. 정리

Ansible은 제어 노드에서 SSH로 관리 노드에 접속해 작업을 실행하는 도구다. 관리 노드에는 아무것도 설치하지 않는다. 작업 대상은 inventory에, 작업 내용은 playbook에 적는다. playbook은 play, play는 task, task는 모듈 하나로 이루어진다.

대부분의 모듈은 원하는 상태를 받아서 이미 그 상태면 `ok`, 바꿨으면 `changed`로 보고한다. 그래서 같은 playbook을 여러 번 실행해도 안전하고, 달라진 설정을 원래대로 되돌리는 데도 쓸 수 있다.

