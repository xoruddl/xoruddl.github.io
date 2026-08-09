---
layout: post
title: "퀵정렬(quick_sort)"
date: 2025-07-04 02:33:49 +0900
categories: ["알고리즘"]
tags: ["CS", "알고리즘", "정렬", "퀵정렬"]
---

# 퀵정렬
- 분할 정복 알고리즘의 하나로 평균적으로 매우 빠른 속도를 가진다. 
- 퀵정렬은 데이터를 메모리상에서 이동시키면서 정렬하기 때문에 CPU 캐시의 효율을 높일 수 있다. 

# 작동원리
## 1. 분할(divide)
배열 안에서 pivot이라 불리는 기준 원소를 하나 선택한다. 
이 pivot을 기준으로 두 개의 부분 배열로 나눈다. 
> pivot보다 작은 부분, pivot보다 큰 부분

## 2. 정복(conquer)
분할된 두 개의 부분 배열에 대해 재귀적으로 퀵정렬을 호출한다. 
부분 배열의 크기가 0 또는 1이 될 때까지 수행한다. 

## 3. 결합(combine)
퀵정렬은 정렬 과정 중에 자동으로 결합이 이루어진다. 
각 부분 배열이 정렬되면 전체 배열 또한 정렬이 완성된다. 

![](https://velog.velcdn.com/images/eta_kyung/post/46d5b8e0-ff09-436c-8d5c-de49ad470f6b/image.png)


> **pivot을 어떻게 정하냐에 따라 성능 차이가 발생할 수 있다.**


맨 처음 원소 사용 or 맨 마지막 원소 사용 or 중간 원소 사용 or 3개의 중앙값

# 장단점
## 장점
- 빠른 평균 속도: 대부분의 경우 $O(N \log N)$의 시간복잡도를 보이며 매우 빠르게 동작한다. 

- 추가 메모리 공간 불필요(In-place): 데이터를 정렬할 때 거의 추가적인 메모리 공간을 사용하지 않아 공간 효율성이 뛰어나다. (재귀 호출을 위한 스택 공간은 필요하다.)

## 단점
- 최악의 경우 성능 저하: 이미 정렬된 배열이나 역으로 정렬된 배열을 정렬할 경우, 피벗 선택이 항상 가장 크거나 작은 값으로 이루어져 $O(N^2)$의 시간 복잡도를 가질 수 있다.

- 불안정 정렬(Unstable Sort): 동일한 값을 가진 원소들의 상대적인 순서가 정렬 후에도 유지되지 않을 수 있다.

# 예시 코드
```
#include <iostream>
#include <algorithm>

using namespace std;

int arr[6] = {1, 3, 2, 5, 6, 4};

void partition(int low, int high, int pivot) {
    int j = low;
    for (int i = low; i <= high; i++) {
        if (arr[i] < arr[pivot]) {
            j++;
            swap(arr[i], arr[j]);
        }
    }
    swap(arr[low], arr[j]);
}

void quickSort(int low, int high) {
    int pivot = low;
    if (low < high) {
        partition(low, high, pivot);
        quickSort(low, pivot - 1);
        quickSort(pivot + 1, high);
    }
}

int main() {
    quickSort(0, 5);

    for (int i = 0; i < 6; i++) {
        cout << arr[i] << " ";
    }
    return 0;
}
```
