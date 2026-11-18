---
layout: post
title: "TypeScript (2) - interface"
date: 2026-11-19 00:30:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "interface"]
---

## 객체 모양을 정하는 interface

`interface`는 객체가 어떤 프로퍼티를 어떤 타입으로 가져야 하는지 정해 둔다. 이렇게 정한 interface를 변수의 타입으로 쓰면, 빠진 프로퍼티가 있거나 타입이 맞지 않을 때 컴파일 에러가 난다.

```ts
type Score = 'A' | 'B' | 'C' | 'F';

interface User {
    name: string;
    age: number;
    gender?: string;
    readonly birthYear: number;
    [grade: number]: Score;
}

let user: User = {
    name: 'xx',
    age: 30,
    birthYear: 2000,
    1: 'A',
    2: 'B'
};

user.age = 10;
user.gender = "male"
// user.birthYear = 1990;

console.log(user.age);
```

`User` 안의 각 문법은 다음 뜻이다.

| 문법 | 의미 |
| --- | --- |
| `gender?: string` | 선택 프로퍼티. 없어도 되고, 나중에 값을 넣어도 된다. |
| `readonly birthYear: number` | 객체를 만들 때만 값을 넣을 수 있다. 그 뒤에 바꾸려 하면 에러가 난다. |
| `[grade: number]: Score` | 인덱스 시그니처. 숫자 키를 몇 개든 둘 수 있고, 그 값은 `Score`여야 한다. |

`Score`는 `type`으로 만든 유니온 타입이다. 값을 `'A'`, `'B'`, `'C'`, `'F'` 넷 중 하나로 제한하므로, `1: 'Z'`처럼 넣으면 에러가 난다. 주석 처리한 `user.birthYear = 1990;`도 `readonly` 때문에 에러가 나는 코드다.

## 함수 타입 정의

interface로 함수의 모양도 정할 수 있다. `(매개변수): 반환 타입` 형태로 적는다.

```ts
interface Add {
    (num1: number, num2: number): number;
}

const add: Add = function(x, y) {
    return x + y;
}

add(10, 20);

interface IsAdult {
    (age: number): boolean;
}

const a: IsAdult = (age) => {
    return age > 19;
}

a(33);
```

함수에 interface 타입을 붙였기 때문에 `x`, `y`, `age`에 타입을 따로 적지 않아도 `number`로 추론된다. 매개변수 이름은 interface와 달라도 되지만, 개수와 타입, 반환 타입은 맞아야 한다.

## implements: 클래스가 interface 따르기

클래스 뒤에 `implements 인터페이스`를 붙이면, 그 클래스는 interface에 정의된 프로퍼티와 메서드를 모두 가져야 한다. 하나라도 빠지면 컴파일 에러가 난다.

```ts
// implements

interface Car {
    color: string;
    wheels: number;
    start(): void;
}

class Bmw implements Car {
    color;
    wheels = 4;

    constructor(c: string) {
        this.color = c;
    }
    start() {
        console.log('go..');
    }
}

const b = new Bmw('green');
console.log(b);
b.start();
```

`color`는 타입을 적지 않았지만, 생성자에서 `string`인 `c`를 대입하므로 `string`으로 추론된다. 실행하면 `color`가 `'green'`, `wheels`가 `4`인 `Bmw` 객체가 출력된 뒤 `go..`가 출력된다.

## extends: interface 확장하기

`extends`를 쓰면 기존 interface의 내용을 그대로 물려받고, 새 프로퍼티를 더할 수 있다. `Benz`는 `Car`의 `color`, `wheels`, `start()`에 `door`, `stop()`이 더해진 타입이다.

```ts
// extends

interface Car {
    color: string;
    wheels: number;
    start(): void;
}

interface Benz extends Car {
    door: number;
    stop(): void;
}

const benz: Benz = {
    door: 5,
    stop() {
        console.log('stop');
    },
    color: 'red',
    wheels: 4,
    start() {
        console.log('go benz..');
    }
}
```

`Benz` 타입 객체를 만들 때는 `Car`에서 물려받은 프로퍼티까지 모두 채워야 한다. `color`를 빼면 에러가 난다.

## 여러 interface 동시에 확장하기

`extends` 뒤에 쉼표로 여러 interface를 적으면 한꺼번에 확장할 수 있다.

```ts
interface Car {
    color: string;
    wheels: number;
    start(): void;
}

interface Toy {
    name: string;
}

interface ToyCar extends Car, Toy {
    price: number;
}
```

`ToyCar`는 `Car`의 `color`, `wheels`, `start()`와 `Toy`의 `name`에 `price`가 더해진 타입이다. 클래스는 하나만 상속할 수 있지만, interface는 이렇게 여러 개를 동시에 확장할 수 있다.
