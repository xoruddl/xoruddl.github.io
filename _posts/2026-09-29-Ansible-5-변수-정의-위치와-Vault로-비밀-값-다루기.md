---
layout: post
title: "Ansible (5) - 변수 정의 위치와 Vault로 비밀 값 다루기"
date: 2026-09-29 09:17:06 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "vault", "yaml"]
---

## 1. 개요

[Ansible (2)](/posts/Ansible-2-변수-반복-템플릿-조건-handler로-playbook-다듬기/)에서는 play의 `vars:`에 변수를 정의했다. 하지만 서버마다 다른 값, 그룹 전체에 같은 값, 실행할 때만 바꾸는 값을 모두 playbook 안에 적으면 playbook을 다른 곳에서 다시 쓰기 어렵다.

Ansible은 변수를 inventory, playbook, 외부 파일, 명령줄 등 여러 곳에 둘 수 있게 해 준다. 이 글에서는 같은 변수를 위치별로 정의해 보며 **어디에 둔 값이 이기는지**를 확인한다. 그리고 비밀번호처럼 그대로 적으면 안 되는 값은 **Ansible Vault**로 암호화한다.

실습은 [Ansible (3)](/posts/Ansible-3-SSH로-실제-서버에-연결하고-ad-hoc-명령-실행하기/)의 `ansible-server` 디렉터리와 `[web]` 그룹을 그대로 쓴다.

---

## 2. 예제 playbook

변수 `user`의 값으로 관리 노드에 계정을 만드는 playbook이다. 이 파일은 고치지 않고, 변수를 정의하는 위치만 바꿔 가며 실행한다.

```yaml
# create-user.yml
- name: 계정 만들기
  hosts: web
  become: true                    # 계정 생성은 관리자 권한 필요
  tasks:
    - name: "{{ user }} 계정 만들기"
      ansible.builtin.user:
        name: "{{ user }}"
        state: present
```

`user` 모듈은 `name`의 계정이 `state: present`면 만들고, `absent`면 지운다. 지금은 `user`를 어디에도 정의하지 않았으므로 실행하면 `'user' is undefined` 오류가 난다.

---

## 3. inventory에 정의하는 변수

### 3.1 그룹 변수

inventory에 `[그룹이름:vars]` 섹션을 만들면 그 그룹의 모든 호스트에 변수가 적용된다. `all`은 모든 호스트를 뜻한다.

```ini
# inventory.ini
[web]
web1 ansible_host=192.168.0.11
web2 ansible_host=192.168.0.12

[all:vars]
user=deploy
```

```bash
ansible-playbook create-user.yml
ansible web -m command -a "ls /home"    # web1, web2 모두: ansible  deploy
```

### 3.2 호스트 변수

호스트 줄 옆에 적은 변수는 그 호스트에만 적용된다. 이미 쓰고 있던 `ansible_host`도 호스트 변수다. 3.1의 inventory에서 `web1` 줄만 바꾼다.

```ini
web1 ansible_host=192.168.0.11 user=deploy1
```

다시 실행하면 `web1`에는 `deploy1`, `web2`에는 `deploy`가 만들어진다. 같은 이름이면 **호스트 변수가 그룹 변수보다 우선**한다.

inventory 파일이 길어지면 [Ansible (2)](/posts/Ansible-2-변수-반복-템플릿-조건-handler로-playbook-다듬기/)에서 소개한 `group_vars/그룹이름.yml`, `host_vars/호스트이름.yml` 파일로 옮겨 YAML로 관리한다. 동작은 같다.

---

## 4. playbook에 정의하는 변수

### 4.1 play 변수

play의 `vars:`에 적은 변수다.

```yaml
- name: 계정 만들기
  hosts: web
  become: true
  vars:
    user: deploy2
  tasks:
    # 2장과 같음
```

실행하면 두 서버 모두 `deploy2`가 만들어진다. inventory의 `deploy1`, `deploy`보다 **play 변수가 우선**한다.

### 4.2 외부 파일: vars_files

변수를 별도 YAML 파일에 모아 두고 play의 `vars_files:`로 불러올 수도 있다. 4.1의 `vars:` 부분을 다음처럼 바꾼다.

```yaml
  vars_files:
    - vars/users.yml      # 내용: user: deploy2
```

환경별로 `vars/dev.yml`, `vars/prod.yml`처럼 파일을 나누어 두면 playbook은 그대로 두고 값만 바꿔 쓸 수 있다.

---

## 5. 실행할 때 넘기는 변수: -e

`ansible-playbook`을 실행할 때 `-e`(`--extra-vars`)로 넘기는 변수를 **추가 변수**라고 한다. 모든 변수 중 우선순위가 가장 높다.

```bash
ansible-playbook create-user.yml -e user=deploy3
ansible-playbook create-user.yml -e "@vars/users.yml"   # 파일로 넘기기
```

---

## 6. 우선순위 정리

같은 이름의 변수가 여러 곳에 있으면 아래 표에서 위에 있는 값이 이긴다. 공식 문서의 전체 순서 중 자주 쓰는 것만 추렸다.

| 우선순위 | 위치 | 예 |
| --- | --- | --- |
| 높음 | 추가 변수 | `-e user=deploy3` |
| ↑ | task 결과 변수 | `register: result` |
| ↑ | play의 `vars_files` | `vars/users.yml` |
| ↑ | play의 `vars` | `vars: user: deploy2` |
| ↑ | 호스트 변수 | `web1 user=deploy1` |
| ↑ | 특정 그룹 변수 | `[web:vars]` |
| 낮음 | `all` 그룹 변수 | `[all:vars]` |

규칙은 대략 "더 좁고 구체적인 곳, 실행 시점에 가까운 곳에 적은 값이 이긴다"로 기억하면 된다. 전체 순서는 [공식 문서의 변수 우선순위](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html#understanding-variable-precedence)에서 확인한다.

실습에서 만든 계정은 `ansible web -m user -a "name=deploy1 state=absent remove=yes" -b`처럼 ad-hoc 명령으로 지운다. `remove=yes`는 홈 디렉터리까지 지운다.

---

## 7. task 결과를 담는 변수: register

task 실행 결과를 `register`로 변수에 저장하면 뒤의 task에서 쓸 수 있다.

```yaml
    - name: "{{ user }} 계정 만들기"
      ansible.builtin.user:
        name: "{{ user }}"
        state: present
      register: result

    - name: 결과 출력
      ansible.builtin.debug:
        var: result
```

```text
ok: [web1] => {
    "result": {
        "changed": true,
        "home": "/home/deploy2",
        "name": "deploy2",
        ...
    }
}
```

`result.home`, `result.changed`처럼 점으로 원하는 값을 꺼내 쓴다.

---

## 8. Ansible Vault로 비밀 값 다루기

### 8.1 왜 필요한가

DB 비밀번호 같은 값을 변수 파일에 그대로 적고 Git에 올리면, 저장소를 볼 수 있는 모든 사람이 비밀번호를 알게 된다. **Ansible Vault**는 변수 파일을 암호화해 두고, 실행할 때만 풀어서 쓰게 해 주는 기능이다.

### 8.2 암호화된 파일 만들기

```bash
ansible-vault create vars/secret.yml
```

먼저 이 파일을 여닫을 **Vault 비밀번호**를 두 번 입력한다. 그러면 편집기가 열리고, 여기에 비밀 값을 적고 저장한다.

```yaml
app_user: deploy
db_password: change-me-please
```

저장한 파일을 그냥 열어 보면 암호화되어 있다.

```bash
cat vars/secret.yml
```

```text
$ANSIBLE_VAULT;1.1;AES256
37303334636562396530653935313930313635346139363536643233633633323431623135666338
3561356161623165333237613964346166643663373134370a353830636535396531333339333632
...
```

| 명령 | 하는 일 |
| --- | --- |
| `ansible-vault view 파일` | 복호화한 내용을 보여 준다 |
| `ansible-vault edit 파일` | 복호화해서 편집기로 열고, 저장하면 다시 암호화한다 |
| `ansible-vault encrypt 파일` | 이미 있는 평문 파일을 암호화한다 |
| `ansible-vault decrypt 파일` | 암호화를 풀어 평문 파일로 되돌린다 |

### 8.3 playbook에서 쓰기

암호화된 파일도 일반 변수 파일처럼 `vars_files`로 불러온다.

```yaml
# create-app-user.yml
- name: 앱 계정과 비밀번호 파일 만들기
  hosts: web
  become: true
  vars_files:
    - vars/secret.yml
  tasks:
    - name: "{{ app_user }} 계정 만들기"
      ansible.builtin.user:
        name: "{{ app_user }}"
        state: present

    - name: DB 비밀번호 파일 만들기
      ansible.builtin.copy:
        dest: "/home/{{ app_user }}/.db_password"
        content: "{{ db_password }}\n"
        owner: "{{ app_user }}"
        mode: "0600"               # 소유자만 읽고 쓸 수 있음
      no_log: true                 # 실행 로그에 비밀 값이 찍히지 않게 함
```

실행할 때 Vault 비밀번호를 입력받도록 `--ask-vault-pass`나 `--vault-id @prompt`를 붙인다. 두 옵션은 같은 동작을 한다.

```bash
ansible-playbook create-app-user.yml --vault-id @prompt
```

옵션 없이 실행하면 `Attempting to decrypt but no vault secrets found` 오류가 난다. 암호화한 `vars/secret.yml`은 Git에 올려도 되지만, Vault 비밀번호 자체는 절대 저장소에 넣지 않는다. 실무에서는 팀 비밀번호 관리 도구에 보관하거나, 권한을 제한한 파일에 두고 `--vault-password-file`로 지정한다. 또 `-v` 옵션으로 자세한 로그를 볼 때 비밀 값이 드러날 수 있으므로, 비밀 값을 쓰는 task에는 `no_log: true`를 붙인다.

---

## 9. 정리

변수는 inventory(그룹 변수, 호스트 변수), playbook(`vars`, `vars_files`), 명령줄(`-e`), task 결과(`register`)에 둘 수 있다. 같은 이름이 겹치면 더 구체적이고 실행 시점에 가까운 곳의 값이 이기며, `-e`가 가장 강하다.

비밀 값은 `ansible-vault create`로 암호화한 파일에 두고 `vars_files`로 불러온 뒤, 실행할 때 `--ask-vault-pass`로 비밀번호를 입력한다. 암호화된 파일은 저장소에 올려도 되지만 Vault 비밀번호는 따로 관리한다.
